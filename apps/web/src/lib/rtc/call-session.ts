import type { RealtimeClient } from "@/lib/realtime"
import type {
  CallKind,
  CallPeer,
  MediaState,
  UserSummary,
} from "@/lib/realtime-events"
import { MeshTransport } from "./mesh-transport"
import { SpeakerDetector } from "./speaker-detector"
import type {
  CallTransport,
  JoinResult,
  PeerConnectionState,
} from "./transport"

/**
 * Framework-free state machine of one call screen: local media (mic, camera, screen), the
 * transport, remote participants and active speaker. `useCall` exposes it to React through
 * `useSyncExternalStore`, so socket/transport handlers never close over stale React state.
 *
 *   lobby ──join()──▶ joining ──▶ in-call ⇄ reconnecting
 *     └──────────────────┴────────────┴──────▶ ended
 */

export type CallPhase =
  "lobby" | "joining" | "in-call" | "reconnecting" | "ended"

/** Key used for the local participant in `speaking` / `activeSpeaker`. */
export const SELF_ID = "self"

export type RemoteParticipant = {
  id: string
  user: UserSummary
  media: MediaState
  stream: MediaStream | null
  connection: PeerConnectionState
}

export type DeviceOption = { deviceId: string; label: string }

export type CallState = {
  phase: CallPhase
  endedReason: string | null
  kind: CallKind | null
  title: string | null
  /** ms timestamp of our join */
  joinedAt: number | null
  /** local media has been requested (the lobby preview is ready, possibly empty) */
  mediaReady: boolean
  mic: boolean
  camera: boolean
  screen: boolean
  /** local camera only (self view) */
  cameraStream: MediaStream | null
  screenStream: MediaStream | null
  participants: RemoteParticipant[]
  speaking: ReadonlySet<string>
  activeSpeaker: string | null
  devices: { audio: DeviceOption[]; video: DeviceOption[] }
  audioDeviceId: string | null
  videoDeviceId: string | null
}

export type CallSessionOptions = {
  callId: string
  getIceServers: () => Promise<RTCIceServer[]>
  onNotice?: (message: string, level: "info" | "error") => void
}

type SignalingSocket = RealtimeClient

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 960 },
  height: { ideal: 540 },
  frameRate: { ideal: 24, max: 30 },
}
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302"] },
]

const INITIAL_STATE: CallState = {
  phase: "lobby",
  endedReason: null,
  kind: null,
  title: null,
  joinedAt: null,
  mediaReady: false,
  mic: false,
  camera: false,
  screen: false,
  cameraStream: null,
  screenStream: null,
  participants: [],
  speaking: new Set(),
  activeSpeaker: null,
  devices: { audio: [], video: [] },
  audioDeviceId: null,
  videoDeviceId: null,
}

function describeMediaError(err: unknown) {
  const name = err instanceof DOMException ? err.name : ""
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "permission denied"
    case "NotFoundError":
    case "OverconstrainedError":
      return "no device found"
    case "NotReadableError":
    case "AbortError":
      return "the device is in use by another app"
    default:
      return err instanceof Error ? err.message : "unavailable"
  }
}

export class CallSession {
  readonly callId: string
  private opts: CallSessionOptions
  private state: CallState = INITIAL_STATE
  private listeners = new Set<() => void>()

  private transport: CallTransport | null = null
  private unbind: (() => void)[] = []
  private speaker: SpeakerDetector
  /** bumps on every activate/deactivate so late async results are discarded */
  private gen = 0
  private busy = new Set<string>()

  private audioTrack: MediaStreamTrack | null = null
  private cameraTrack: MediaStreamTrack | null = null
  private screenTrack: MediaStreamTrack | null = null

  private remote = new Map<string, RemoteParticipant>()
  /** streams that arrived before the participant info (lazy links) */
  private orphanStreams = new Map<string, MediaStream>()

  constructor(opts: CallSessionOptions) {
    this.opts = opts
    this.callId = opts.callId
    this.speaker = new SpeakerDetector(({ speaking, active }) =>
      this.patch({ speaking, activeSpeaker: active })
    )
  }

  // --- external store ----------------------------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  private patch(partial: Partial<CallState>) {
    this.state = { ...this.state, ...partial }
    for (const listener of [...this.listeners]) listener()
  }

  private notice(message: string, level: "info" | "error" = "error") {
    this.opts.onNotice?.(message, level)
  }

  // --- lifecycle ---------------------------------------------------------------------------------

  /** Called when the call screen mounts (and the call type is known): starts the lobby preview. */
  activate(kind: CallKind) {
    const gen = ++this.gen
    if (this.state.phase !== "lobby") return
    this.patch({ kind })
    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      this.refreshDevices
    )
    void this.acquireInitial(kind, gen)
  }

  /** Called when the call screen unmounts: leaves the call and releases every device. */
  deactivate() {
    this.gen++
    navigator.mediaDevices?.removeEventListener?.(
      "devicechange",
      this.refreshDevices
    )
    if (this.state.phase === "lobby") {
      this.stopLocalMedia()
      this.patch({ mediaReady: false })
    } else {
      this.end("You left the call")
    }
  }

  /** The call ended before we joined (ring timeout, caller hung up). */
  markEnded(reason = "The call has ended") {
    if (this.state.phase === "ended") return
    this.end(reason)
  }

  async join(socket: SignalingSocket) {
    if (this.state.phase !== "lobby") return
    const gen = this.gen
    this.patch({ phase: "joining" })
    // inside the click handler: lets the AudioContext start despite autoplay policies
    this.speaker.start()

    const iceServers = await this.opts
      .getIceServers()
      .catch(() => DEFAULT_ICE_SERVERS)
    if (gen !== this.gen || this.getSnapshot().phase !== "joining") return

    const transport = new MeshTransport({
      socket,
      callId: this.callId,
      iceServers,
    })
    this.transport = transport
    this.bind(transport)
    const tracks = [this.audioTrack, this.cameraTrack].filter(
      (t): t is MediaStreamTrack => t !== null
    )

    let result: JoinResult
    try {
      result = await transport.join(
        tracks.length ? new MediaStream(tracks) : null,
        this.mediaState()
      )
    } catch (err) {
      if (this.transport === transport)
        this.end(err instanceof Error ? err.message : "Could not join the call")
      return
    }
    if (this.transport !== transport) return
    this.applyJoin(result)
    this.patch({ phase: "in-call", joinedAt: Date.now() })
    this.trackSelfAudio()
  }

  leave() {
    if (this.state.phase === "ended") return
    this.end("You left the call")
  }

  private end(reason: string) {
    this.gen++
    this.unbindTransport()
    this.transport?.dispose()
    this.transport = null
    this.stopLocalMedia()
    this.speaker.stop()
    this.remote.clear()
    this.orphanStreams.clear()
    this.patch({
      phase: "ended",
      endedReason: reason,
      participants: [],
      speaking: new Set(),
      activeSpeaker: null,
    })
  }

  // --- transport events --------------------------------------------------------------------------

  private bind(t: CallTransport) {
    this.unbind = [
      t.on("participant-joined", (peer) => {
        this.upsertPeer(peer)
        this.emitParticipants()
      }),
      t.on("participant-left", (id) => {
        this.remote.delete(id)
        this.orphanStreams.delete(id)
        this.speaker.remove(id)
        this.emitParticipants()
      }),
      t.on("participant-media", (id, media) => {
        const p = this.remote.get(id)
        if (!p) return
        this.remote.set(id, { ...p, media })
        this.emitParticipants()
      }),
      t.on("stream", (id, stream) => {
        this.speaker.setStream(id, stream)
        const p = this.remote.get(id)
        if (!p) {
          this.orphanStreams.set(id, stream)
          return
        }
        this.remote.set(id, { ...p, stream })
        this.emitParticipants()
      }),
      t.on("connection-state", (id, connection) => {
        const p = this.remote.get(id)
        if (!p || p.connection === connection) return
        this.remote.set(id, { ...p, connection })
        this.emitParticipants()
      }),
      t.on("reconnecting", () => {
        for (const id of this.remote.keys()) this.speaker.remove(id)
        for (const [id, p] of this.remote)
          this.remote.set(id, { ...p, stream: null, connection: "new" })
        this.emitParticipants()
        this.patch({ phase: "reconnecting" })
      }),
      t.on("rejoined", (result) => {
        this.applyJoin(result)
        this.patch({ phase: "in-call" })
      }),
      t.on("declined", (user) =>
        this.notice(`${user.name} declined the call`, "info")
      ),
      t.on("ended", (reason) => this.end(reason)),
    ]
  }

  private unbindTransport() {
    for (const off of this.unbind) off()
    this.unbind = []
  }

  private applyJoin(result: JoinResult) {
    for (const id of this.remote.keys()) this.speaker.remove(id)
    this.remote.clear()
    for (const peer of result.peers) this.upsertPeer(peer)
    this.emitParticipants()
    this.patch({ title: result.title, kind: result.call.type })
  }

  private upsertPeer(peer: CallPeer) {
    const existing = this.remote.get(peer.socketId)
    const stream =
      existing?.stream ?? this.orphanStreams.get(peer.socketId) ?? null
    this.orphanStreams.delete(peer.socketId)
    this.remote.set(peer.socketId, {
      id: peer.socketId,
      user: peer.user,
      media: peer.media,
      stream,
      connection: existing?.connection ?? "new",
    })
  }

  private emitParticipants() {
    this.patch({ participants: [...this.remote.values()] })
  }

  // --- local media -------------------------------------------------------------------------------

  private mediaState(): MediaState {
    return {
      audio: Boolean(
        this.audioTrack?.enabled && this.audioTrack.readyState === "live"
      ),
      video: Boolean(this.cameraTrack),
      screen: Boolean(this.screenTrack),
    }
  }

  private broadcast() {
    const media = this.mediaState()
    this.patch({ mic: media.audio, camera: media.video, screen: media.screen })
    this.transport?.setMedia(media)
  }

  private async acquireInitial(kind: CallKind, gen: number) {
    const md =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined
    if (!md?.getUserMedia) {
      this.notice(
        "Your browser can't access a camera or microphone here (HTTPS is required). You'll join listen-only."
      )
      this.patch({ mediaReady: true })
      return
    }
    const wantVideo = kind === "VIDEO"
    let stream: MediaStream | null = null
    try {
      stream = await md.getUserMedia({
        audio: this.withDevice(AUDIO_CONSTRAINTS, this.state.audioDeviceId),
        video: wantVideo
          ? this.withDevice(VIDEO_CONSTRAINTS, this.state.videoDeviceId)
          : false,
      })
    } catch (err) {
      if (wantVideo) {
        console.log(err)

        try {
          stream = await md.getUserMedia({ audio: AUDIO_CONSTRAINTS })
          this.notice(`Camera unavailable: ${describeMediaError(err)}`)
        } catch (err2) {
          this.notice(
            `Microphone unavailable (${describeMediaError(err2)}). You'll join listen-only.`
          )
        }
      } else {
        this.notice(
          `Microphone unavailable (${describeMediaError(err)}). You'll join listen-only.`
        )
      }
    }
    if (gen !== this.gen) {
      for (const track of stream?.getTracks() ?? []) track.stop()
      return
    }
    this.setAudioTrack(stream?.getAudioTracks()[0] ?? null)
    this.setCameraTrack(stream?.getVideoTracks()[0] ?? null)
    // "Join" can be clicked before the devices resolve: hand late tracks to the live transport
    if (this.transport) {
      await this.transport.replaceAudioTrack(this.audioTrack)
      await this.transport.replaceVideoTrack(this.cameraTrack)
      this.trackSelfAudio()
    }
    this.patch({ mediaReady: true })
    this.broadcast()
    void this.refreshDevices()
  }

  private withDevice(
    base: MediaTrackConstraints,
    deviceId: string | null
  ): MediaTrackConstraints {
    return deviceId ? { ...base, deviceId: { exact: deviceId } } : base
  }

  private async getTrack(
    kind: "audio" | "video",
    deviceId: string | null
  ): Promise<MediaStreamTrack | null> {
    const md = navigator.mediaDevices
    if (!md?.getUserMedia) {
      this.notice(
        "Your browser can't access media devices here (HTTPS is required)"
      )
      return null
    }
    const base = kind === "audio" ? AUDIO_CONSTRAINTS : VIDEO_CONSTRAINTS
    try {
      const stream = await md.getUserMedia({
        [kind]: this.withDevice(base, deviceId),
      })
      return stream.getTracks()[0] ?? null
    } catch (err) {
      this.notice(
        `${kind === "audio" ? "Microphone" : "Camera"} unavailable: ${describeMediaError(err)}`
      )
      return null
    }
  }

  private setAudioTrack(track: MediaStreamTrack | null) {
    this.audioTrack = track
    if (track) {
      track.addEventListener("ended", () => {
        if (this.audioTrack !== track) return
        this.audioTrack = null
        void this.transport?.replaceAudioTrack(null)
        this.speaker.remove(SELF_ID)
        this.broadcast()
      })
    }
  }

  private setCameraTrack(track: MediaStreamTrack | null) {
    this.cameraTrack = track
    this.patch({ cameraStream: track ? new MediaStream([track]) : null })
    if (track) {
      track.addEventListener("ended", () => {
        if (this.cameraTrack !== track) return
        this.setCameraTrack(null)
        void this.transport?.replaceVideoTrack(null)
        this.broadcast()
      })
    }
  }

  private trackSelfAudio() {
    this.speaker.setStream(
      SELF_ID,
      this.audioTrack ? new MediaStream([this.audioTrack]) : null
    )
  }

  private stopLocalMedia() {
    for (const track of [this.audioTrack, this.cameraTrack, this.screenTrack])
      track?.stop()
    this.audioTrack = null
    this.cameraTrack = null
    this.screenTrack = null
    this.patch({
      mic: false,
      camera: false,
      screen: false,
      cameraStream: null,
      screenStream: null,
    })
  }

  /** Runs one toggle at a time per device kind (double clicks, slow permission prompts). */
  private async exclusive(key: string, fn: (gen: number) => Promise<void>) {
    if (this.busy.has(key) || this.state.phase === "ended") return
    this.busy.add(key)
    try {
      await fn(this.gen)
    } finally {
      this.busy.delete(key)
    }
  }

  toggleMic = () =>
    this.exclusive("audio", async (gen) => {
      if (this.audioTrack) {
        this.audioTrack.enabled = !this.audioTrack.enabled
        this.broadcast()
        return
      }
      const track = await this.getTrack("audio", this.state.audioDeviceId)
      if (!track) return
      if (gen !== this.gen) return track.stop()
      this.setAudioTrack(track)
      await this.transport?.replaceAudioTrack(track)
      if (this.transport) this.trackSelfAudio()
      this.broadcast()
      void this.refreshDevices()
    })

  toggleCamera = () =>
    this.exclusive("video", async (gen) => {
      if (this.cameraTrack) {
        // stop the track (not just disable it) so the camera light goes off
        const track = this.cameraTrack
        this.setCameraTrack(null)
        track.stop()
        await this.transport?.replaceVideoTrack(null)
        this.broadcast()
        return
      }
      const track = await this.getTrack("video", this.state.videoDeviceId)
      if (!track) return
      if (gen !== this.gen) return track.stop()
      this.setCameraTrack(track)
      await this.transport?.replaceVideoTrack(track)
      this.broadcast()
      void this.refreshDevices()
    })

  toggleScreen = () =>
    this.exclusive("screen", async (gen) => {
      if (this.screenTrack) return this.stopScreen()
      if (!this.transport) return
      const md = navigator.mediaDevices
      if (!md?.getDisplayMedia)
        return this.notice("Screen sharing isn't supported in this browser")
      let stream: MediaStream
      try {
        stream = await md.getDisplayMedia({ video: true, audio: false })
      } catch (err) {
        // the user closing the picker is not an error worth reporting
        if (!(err instanceof DOMException && err.name === "NotAllowedError")) {
          this.notice(`Couldn't share your screen: ${describeMediaError(err)}`)
        }
        return
      }
      const track = stream.getVideoTracks()[0]
      if (!track) return
      if (gen !== this.gen || !this.transport) return track.stop()
      this.screenTrack = track
      // the browser's own "Stop sharing" button ends the track
      track.addEventListener("ended", () => {
        if (this.screenTrack === track) void this.stopScreen()
      })
      this.patch({ screenStream: new MediaStream([track]) })
      await this.transport.setScreenShare(track)
      this.broadcast()
    })

  private async stopScreen() {
    const track = this.screenTrack
    if (!track) return
    this.screenTrack = null
    track.stop()
    this.patch({ screenStream: null })
    // back to the camera (or no video)
    await this.transport?.setScreenShare(null)
    this.broadcast()
  }

  /** Switches the microphone or camera to another device. */
  selectDevice = (kind: "audio" | "video", deviceId: string) =>
    this.exclusive(kind, async (gen) => {
      if (kind === "audio") {
        this.patch({ audioDeviceId: deviceId })
        if (!this.audioTrack) return
        const wasEnabled = this.audioTrack.enabled
        const track = await this.getTrack("audio", deviceId)
        if (!track) return
        if (gen !== this.gen) return track.stop()
        track.enabled = wasEnabled
        const old = this.audioTrack
        this.setAudioTrack(track)
        old.stop()
        await this.transport?.replaceAudioTrack(track)
        if (this.transport) this.trackSelfAudio()
      } else {
        this.patch({ videoDeviceId: deviceId })
        if (!this.cameraTrack) return
        const track = await this.getTrack("video", deviceId)
        if (!track) return
        if (gen !== this.gen) return track.stop()
        const old = this.cameraTrack
        this.setCameraTrack(track)
        old.stop()
        await this.transport?.replaceVideoTrack(track)
      }
      this.broadcast()
    })

  private refreshDevices = async () => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices) return
    try {
      const all = await md.enumerateDevices()
      const pick = (kind: MediaDeviceKind, fallback: string) =>
        all
          .filter((d) => d.kind === kind && d.deviceId)
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || `${fallback} ${i + 1}`,
          }))
      const current = (track: MediaStreamTrack | null) =>
        track?.getSettings().deviceId ?? null
      this.patch({
        devices: {
          audio: pick("audioinput", "Microphone"),
          video: pick("videoinput", "Camera"),
        },
        audioDeviceId: current(this.audioTrack) ?? this.state.audioDeviceId,
        videoDeviceId: current(this.cameraTrack) ?? this.state.videoDeviceId,
      })
    } catch {
      // device listing is a nicety
    }
  }
}
