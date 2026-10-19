import type { RealtimeClient } from "@/lib/realtime"
import {
  type CallKind,
  type CallPeer,
  type CaptionLang,
  type CaptionPrefs,
  type CaptionSegment,
  type ClientPayload,
  type MediaState,
  type ServerPayload,
  type TranscriptEntry,
  type UserSummary,
  isCaptionLang,
} from "@/lib/realtime-events"
import { CaptionTokens, type CaptionStatus } from "./caption-stream"
import { Captioner } from "./captioner"
import { Translators } from "./translator"
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
  captions: CaptionPrefs
}

export type CaptionPart = { text: string; final: boolean }

/**
 * One utterance of one speaker: the original (`source`, in `sourceLang`, from the speaker's
 * browser via the server) and, when we read another language, its translation (made in our
 * browser from their audio). Both arrive separately and are paired by utterance id.
 */
export type CaptionLine = {
  /** `${speaker userId}:${utteranceId}` (stable across the speaker's reconnects) */
  id: string
  user: UserSummary
  self: boolean
  sourceLang: CaptionLang
  source: CaptionPart | null
  translation: CaptionPart | null
  /** no translation will come (said before we joined, or translating failed): show the original */
  untranslated: boolean
  /** when the utterance started (server clock once the original arrived): the order */
  startedAt: number
  /** last update (local clock) */
  at: number
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
  captions: CaptionPrefs
  /** false once the server said captions aren't available (no Gemini key) */
  captionsAvailable: boolean
  captionStatus: CaptionStatus
  /** why our captioning failed (shown in the CC menu) */
  captionError: string | null
  /** recent lines shown over the call */
  captionLines: CaptionLine[]
  /** every utterance with final text in this call, oldest first */
  transcript: CaptionLine[]
  /** someone in the call reads captions: speech is sent to Gemini (consent banner) */
  captionsActive: boolean
  /** the call's shared glossary (biases the transcribers) */
  glossary: string[]
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
const CAPTIONS_KEY = "call-captions"
const CAPTION_VISIBLE_MS = 8_000
const MAX_CAPTION_LINES = 3
const MAX_TRANSCRIPT = 1_000
/** a final original with no translation by then is shown untranslated */
const TRANSLATION_WAIT_MS = 10_000
/** finals said while our socket was down, resent once we're back in the call */
const MAX_OUTBOX = 50

function loadCaptionPrefs(): CaptionPrefs {
  const browserLang = navigator.language?.slice(0, 2)
  const fallback: CaptionPrefs = {
    enabled: false,
    lang: isCaptionLang(browserLang) ? browserLang : "en",
  }
  try {
    const saved = JSON.parse(
      localStorage.getItem(CAPTIONS_KEY) ?? "null"
    ) as Partial<CaptionPrefs> | null
    if (!saved) return fallback
    return {
      enabled: Boolean(saved.enabled),
      lang: isCaptionLang(saved.lang) ? saved.lang : fallback.lang,
    }
  } catch {
    return fallback
  }
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
  captions: { enabled: false, lang: "en" },
  captionsAvailable: true,
  captionStatus: "off",
  captionError: null,
  captionLines: [],
  transcript: [],
  captionsActive: false,
  glossary: [],
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
  private socket: SignalingSocket | null = null
  private tokens: CaptionTokens
  private captioner: Captioner
  private translators: Translators
  private captionTimer: number | undefined
  private outbox: ClientPayload<"call:caption">[] = []
  private speakStatus: { status: CaptionStatus; error: string | null } = {
    status: "off",
    error: null,
  }
  private readStatus: { status: CaptionStatus; error: string | null } = {
    status: "off",
    error: null,
  }
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
    this.state = { ...INITIAL_STATE, captions: loadCaptionPrefs() }
    this.tokens = new CaptionTokens(opts.callId)
    const onUnavailable = (message: string) => {
      if (!this.state.captionsAvailable) return
      this.patch({ captionsAvailable: false })
      this.notice(message)
    }
    this.captioner = new Captioner({
      tokens: this.tokens,
      onSegment: (segment) => this.sendCaption(segment),
      onMark: (mark) => {
        if (this.socket?.connected && this.state.phase === "in-call")
          this.socket.emit("call:caption-mark", { callId: this.callId, ...mark })
      },
      onUnavailable,
      onStatus: (status, error) => {
        this.speakStatus = { status, error }
        this.patchCaptionStatus()
      },
    })
    this.translators = new Translators({
      tokens: this.tokens,
      onTranslation: (speakerId, segment) =>
        this.receiveTranslation(speakerId, segment),
      onUnavailable,
      onStatus: (status, error) => {
        this.readStatus = { status, error }
        this.patchCaptionStatus()
      },
    })
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

    this.socket = socket
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
        this.mediaState(),
        this.state.captions
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
    // the token pair is fetched at join, so the first caption sessions open without waiting
    if (result.captions) this.tokens.prefetch()
    this.syncCaptioner()
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
    this.captioner.stop()
    this.translators.stop()
    this.outbox = []
    window.clearInterval(this.captionTimer)
    this.captionTimer = undefined
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
      captionLines: [],
      captionsActive: false,
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
      t.on("participant-captions", (id, captions) => {
        const p = this.remote.get(id)
        if (!p) return
        this.remote.set(id, { ...p, captions })
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
        this.flushOutbox()
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
    this.patch({
      title: result.title,
      kind: result.call.type,
      captionsAvailable: result.captions && this.state.captionsAvailable,
      glossary: result.glossary,
    })
    this.mergeHistory(result.transcript)
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
      captions: peer.captions,
    })
  }

  private emitParticipants() {
    this.patch({ participants: [...this.remote.values()] })
    this.syncCaptioner()
  }

  // --- captions ----------------------------------------------------------------------------------

  /** Turns captions on/off or changes our language (spoken and read). Works in the lobby too. */
  setCaptions = (captions: CaptionPrefs) => {
    this.patch({ captions })
    try {
      localStorage.setItem(CAPTIONS_KEY, JSON.stringify(captions))
    } catch {
      // remembering the choice is a nicety
    }
    this.transport?.setCaptions(captions)
    this.syncCaptioner()
  }

  /**
   * Our microphone is transcribed while anyone in the call (us included) reads captions; while
   * we read them, every speaker of another language is translated into ours.
   */
  private syncCaptioner() {
    const { phase, captions, captionsAvailable } = this.state
    const joined = phase === "in-call" || phase === "reconnecting"
    const remote = [...this.remote.values()]
    const active =
      joined &&
      captionsAvailable &&
      (captions.enabled || remote.some((p) => p.captions.enabled))
    this.captioner.configure(captions.lang, active)
    this.captioner.setTrack(
      joined ? this.audioTrack : null,
      !(this.audioTrack?.enabled && this.audioTrack.readyState === "live")
    )
    this.translators.sync(
      joined && captionsAvailable && captions.enabled ? captions.lang : null,
      remote.map((p) => ({ id: p.id, lang: p.captions.lang, stream: p.stream }))
    )
    if (active !== this.state.captionsActive)
      this.patch({ captionsActive: active })
  }

  private patchCaptionStatus() {
    const rank: Record<CaptionStatus, number> = {
      off: 0,
      live: 1,
      connecting: 2,
      error: 3,
    }
    const worst =
      rank[this.readStatus.status] > rank[this.speakStatus.status]
        ? this.readStatus
        : this.speakStatus
    if (worst.error && worst.error !== this.state.captionError)
      this.notice(`Live captions failed: ${worst.error}`)
    this.patch({ captionStatus: worst.status, captionError: worst.error })
  }

  /** Sets the call's glossary (names, product terms) for everyone's transcriber. */
  setGlossary = (terms: string[]) => {
    if (!this.socket?.connected || this.state.phase !== "in-call") return
    this.socket.emit("call:glossary", { callId: this.callId, terms })
  }

  receiveGlossary(p: ServerPayload<"call:glossary">) {
    if (p.callId !== this.callId) return
    this.patch({ glossary: p.terms })
    this.captioner.glossaryChanged()
  }

  /** Utterance boundaries of a remote speaker: drives our translation of their audio. */
  receiveMark(p: ServerPayload<"call:caption-mark">) {
    if (p.callId !== this.callId) return
    this.translators.mark(p.from, p)
  }

  private sendCaption(segment: CaptionSegment) {
    const payload = { callId: this.callId, ...segment }
    if (this.socket?.connected && this.state.phase === "in-call")
      return this.socket.emit("call:caption", payload)
    // partials are stale by the time we're back; finals are resent (the server dedupes them)
    if (segment.final) this.outbox = [...this.outbox, payload].slice(-MAX_OUTBOX)
  }

  private flushOutbox() {
    const pending = this.outbox
    this.outbox = []
    for (const payload of pending) this.sendCaption(payload)
  }

  /** The original of an utterance, from the server (our own come back too, in its order). */
  receiveCaption(p: ServerPayload<"call:caption">) {
    if (p.callId !== this.callId || this.state.phase === "ended") return
    const self = p.from === this.socket?.id
    const user = self
      ? { id: p.userId, name: p.name, image: null }
      : (this.remote.get(p.from)?.user ??
        [...this.remote.values()].find((r) => r.user.id === p.userId)?.user)
    if (!user) return
    if (!self) this.translators.source(p.from, p)
    const translated = !self && this.translators.translates(p.from)
    this.updateLine(`${p.userId}:${p.utteranceId}`, p.final, (existing) => ({
      user,
      self,
      sourceLang: p.lang,
      source: { text: p.text, final: p.final },
      translation: existing?.translation ?? null,
      untranslated:
        p.lang !== this.state.captions.lang && !existing?.translation && !translated,
      startedAt: p.ts,
    }))
  }

  /** Our translation of a remote speaker's utterance. */
  private receiveTranslation(
    speakerId: string,
    s: { utteranceId: string; text: string; final: boolean }
  ) {
    const peer = this.remote.get(speakerId)
    if (!peer || this.state.phase === "ended") return
    this.updateLine(`${peer.user.id}:${s.utteranceId}`, s.final, (existing) => ({
      user: peer.user,
      self: false,
      sourceLang: peer.captions.lang,
      source: existing?.source ?? null,
      translation: { text: s.text, final: s.final },
      untranslated: false,
      startedAt: existing?.startedAt ?? Date.now(),
    }))
  }

  private updateLine(
    id: string,
    final: boolean,
    make: (existing: CaptionLine | undefined) => Omit<CaptionLine, "id" | "at">
  ) {
    const existing =
      this.state.captionLines.find((l) => l.id === id) ??
      this.state.transcript.find((l) => l.id === id)
    const line: CaptionLine = { ...make(existing), id, at: Date.now() }
    const byStart = (a: CaptionLine, b: CaptionLine) => a.startedAt - b.startedAt
    const lines = [...this.state.captionLines.filter((l) => l.id !== id), line]
      .sort(byStart)
      .slice(-MAX_CAPTION_LINES)
    const inTranscript = this.state.transcript.some((l) => l.id === id)
    // a line enters the transcript once its original (or translation) is final
    const transcript =
      final || inTranscript
        ? [...this.state.transcript.filter((l) => l.id !== id), line]
          .sort(byStart)
          .slice(-MAX_TRANSCRIPT)
        : this.state.transcript
    this.patch({ captionLines: lines, transcript })
    this.captionTimer ??= window.setInterval(this.pruneCaptions, 1_000)
  }

  /** What was said before we (re)joined: originals only, in the server's order. */
  private mergeHistory(entries: TranscriptEntry[]) {
    if (!entries.length) return
    const known = new Set(this.state.transcript.map((l) => l.id))
    const me = this.socket?.id
    const added: CaptionLine[] = entries
      .filter((e) => !known.has(`${e.user.id}:${e.utteranceId}`))
      .map((e) => ({
        id: `${e.user.id}:${e.utteranceId}`,
        user: e.user,
        self: e.socketId === me,
        sourceLang: e.lang,
        source: { text: e.text, final: true },
        translation: null,
        untranslated: e.lang !== this.state.captions.lang,
        startedAt: e.ts,
        at: e.ts,
      }))
    if (!added.length) return
    this.patch({
      transcript: [...this.state.transcript, ...added]
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(-MAX_TRANSCRIPT),
    })
  }

  private pruneCaptions = () => {
    const now = Date.now()
    const lines = this.state.captionLines.filter(
      (l) => l.at > now - CAPTION_VISIBLE_MS
    )
    // a translation that never came (the speaker's audio dropped, translating failed)
    const stuck = (l: CaptionLine) =>
      !l.untranslated &&
      !l.translation &&
      l.source?.final === true &&
      l.sourceLang !== this.state.captions.lang &&
      now - l.at > TRANSLATION_WAIT_MS
    const settle = (l: CaptionLine) => (stuck(l) ? { ...l, untranslated: true } : l)
    if (
      lines.length !== this.state.captionLines.length ||
      this.state.transcript.some(stuck)
    )
      this.patch({
        captionLines: lines.map(settle),
        transcript: this.state.transcript.map(settle),
      })
    const waiting = this.state.transcript.some(
      (l) => !l.untranslated && !l.translation && l.sourceLang !== this.state.captions.lang
    )
    if (!lines.length && !waiting) {
      window.clearInterval(this.captionTimer)
      this.captionTimer = undefined
    }
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
    this.syncCaptioner()
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
