import type { RealtimeClient } from "@/lib/realtime"
import {
  CAPTION_PAIR,
  type CallPeer,
  type CaptionPrefs,
  type MediaState,
  type RtcSignal,
  type UserSummary,
} from "@/lib/realtime-events"
import {
  type CallTransport,
  Emitter,
  type JoinResult,
  type TransportEvents,
} from "./transport"
import i18n from "@/lib/i18n"

type SignalingSocket = RealtimeClient

const JOIN_TIMEOUT_MS = 15_000
/** how long a peer may stay "disconnected" before we force an ICE restart */
const DISCONNECTED_GRACE_MS = 4_000

/** One RTCPeerConnection to one remote socket + its perfect-negotiation state. */
type PeerLink = {
  id: string
  pc: RTCPeerConnection
  /** the polite peer yields on offer collisions (deterministic: lower socket id is polite) */
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  isSettingRemoteAnswerPending: boolean
  audioSender: RTCRtpSender | null
  videoSender: RTCRtpSender | null
  /** remote tracks (at most one per kind) */
  tracks: Map<string, MediaStreamTrack>
  restartTimer: ReturnType<typeof setTimeout> | null
}

export type MeshTransportOptions = {
  socket: SignalingSocket
  callId: string
  iceServers: RTCIceServer[]
}

/**
 * Full-mesh P2P transport: every participant holds one RTCPeerConnection per other participant.
 *
 * Negotiation follows MDN's "perfect negotiation" pattern, so either side may (re)negotiate at any
 * time (tracks added later, ICE restarts) without coordinating who offers:
 *   - `negotiationneeded` → `setLocalDescription()` → send `{ description }`;
 *   - on an incoming offer that collides with our own, the impolite peer ignores it and the polite
 *     one rolls back (implicitly, via `setRemoteDescription`) and answers.
 * Who connects: the joiner creates links to every peer in the join ack; existing members create
 * theirs on `call:peer-joined`. A signal from an unknown socket also creates the link lazily.
 *
 * Screen sharing swaps the outgoing video track on the existing video sender (`replaceTrack`):
 * no renegotiation, and the remote side keeps the same receiver/track. When nothing was sent yet
 * (audio call, camera off from the start) the track is added instead, which renegotiates.
 */
export class MeshTransport
  extends Emitter<TransportEvents>
  implements CallTransport
{
  readonly callId: string
  private socket: SignalingSocket
  private iceServers: RTCIceServer[]
  private links = new Map<string, PeerLink>()
  /** groups our outgoing tracks under one msid on the remote side */
  private outStream = new MediaStream()
  private audioTrack: MediaStreamTrack | null = null
  private cameraTrack: MediaStreamTrack | null = null
  private screenTrack: MediaStreamTrack | null = null
  private media: MediaState = { audio: false, video: false, screen: false }
  private captions: CaptionPrefs = { enabled: false, lang: CAPTION_PAIR[0] }
  private selfId: string | null = null
  private joined = false
  private closed = false
  private detach: (() => void) | null = null

  constructor({ socket, callId, iceServers }: MeshTransportOptions) {
    super()
    this.socket = socket
    this.callId = callId
    this.iceServers = iceServers
  }

  async join(
    localStream: MediaStream | null,
    media: MediaState,
    captions: CaptionPrefs
  ): Promise<JoinResult> {
    if (this.closed) throw new Error(i18n.t("call.session.callLeft"))
    this.captions = captions
    this.audioTrack = localStream?.getAudioTracks()[0] ?? null
    this.cameraTrack = localStream?.getVideoTracks()[0] ?? null
    this.media = media
    this.listen()
    try {
      return await this.signalJoin()
    } catch (err) {
      this.teardown()
      throw err
    }
  }

  leave() {
    if (this.closed) return
    if (this.joined && this.socket.connected)
      this.socket.emit("call:leave", { callId: this.callId })
    this.teardown()
  }

  async replaceVideoTrack(track: MediaStreamTrack | null) {
    this.cameraTrack = track
    if (!this.screenTrack) await this.syncVideo()
  }

  async replaceAudioTrack(track: MediaStreamTrack | null) {
    this.audioTrack = track
    await Promise.all(
      [...this.links.values()].map((link) =>
        this.sendTrack(link, "audio", track)
      )
    )
  }

  async setScreenShare(track: MediaStreamTrack | null) {
    this.screenTrack = track
    if (track) track.contentHint = "detail"
    await this.syncVideo()
  }

  setMedia(media: MediaState) {
    this.media = media
    if (this.joined && this.socket.connected)
      this.socket.emit("call:media", { callId: this.callId, media })
  }

  setCaptions(captions: CaptionPrefs) {
    this.captions = captions
    if (this.joined && this.socket.connected)
      this.socket.emit("call:captions", { callId: this.callId, captions })
  }

  // --- signaling -------------------------------------------------------------------------------

  private async signalJoin(): Promise<JoinResult> {
    const res = await this.socket
      .timeout(JOIN_TIMEOUT_MS)
      .emitWithAck("call:join", {
        callId: this.callId,
        media: this.media,
        captions: this.captions,
      })
      .catch(() => ({
        ok: false as const,
        error: i18n.t("call.session.noAnswer"),
      }))
    if (!res.ok) throw new Error(res.error)
    if (this.closed) {
      // left while the join was in flight
      this.socket.emit("call:leave", { callId: this.callId })
      throw new Error(i18n.t("call.session.callLeft"))
    }
    this.selfId = this.socket.id ?? null
    this.joined = true
    for (const peer of res.data.peers) this.connect(peer.socketId)
    this.applyBitrateCaps()
    return res.data
  }

  private listen() {
    const s = this.socket
    const onPeerJoined = (peer: CallPeer & { callId: string }) => {
      if (
        !this.joined ||
        peer.callId !== this.callId ||
        peer.socketId === this.selfId
      )
        return
      this.emit("participant-joined", peer)
      this.connect(peer.socketId)
      this.applyBitrateCaps()
    }
    const onPeerLeft = ({
      callId,
      socketId,
    }: {
      callId: string
      socketId: string
      userId: string
    }) => {
      if (!this.joined || callId !== this.callId) return
      this.disconnect(socketId)
      this.emit("participant-left", socketId)
      this.applyBitrateCaps()
    }
    const onPeerMedia = ({
      callId,
      socketId,
      media,
    }: {
      callId: string
      socketId: string
      media: MediaState
    }) => {
      if (this.joined && callId === this.callId)
        this.emit("participant-media", socketId, media)
    }
    const onPeerCaptions = ({
      callId,
      socketId,
      captions,
    }: {
      callId: string
      socketId: string
      captions: CaptionPrefs
    }) => {
      if (this.joined && callId === this.callId)
        this.emit("participant-captions", socketId, captions)
    }
    const onSignal = ({
      callId,
      from,
      data,
    }: {
      callId: string
      from: string
      data: RtcSignal
    }) => {
      if (callId !== this.callId || !this.joined || from === this.selfId) return
      void this.handleSignal(this.connect(from), data)
    }
    const onEnded = ({ callId }: { callId: string }) => {
      if (callId !== this.callId) return
      this.teardown()
      this.emit("ended", i18n.t("call.ended.default"))
    }
    const onDeclined = ({
      callId,
      user,
    }: {
      callId: string
      user: UserSummary
    }) => {
      if (callId === this.callId) this.emit("declined", user)
    }
    const onDisconnect = () => {
      if (!this.joined || this.closed) return
      // the server drops us from the call when our socket goes away: start over on reconnect
      this.joined = false
      for (const id of [...this.links.keys()]) this.disconnect(id)
      this.emit("reconnecting")
    }
    const onConnect = () => {
      if (this.joined || this.closed || !this.selfId) return
      this.signalJoin().then(
        (result) => this.emit("rejoined", result),
        (err: unknown) => {
          this.teardown()
          this.emit(
            "ended",
            err instanceof Error
              ? err.message
              : i18n.t("call.session.couldNotRejoin")
          )
        }
      )
    }

    s.on("call:peer-joined", onPeerJoined)
    s.on("call:peer-left", onPeerLeft)
    s.on("call:peer-media", onPeerMedia)
    s.on("call:peer-captions", onPeerCaptions)
    s.on("rtc:signal", onSignal)
    s.on("call:ended", onEnded)
    s.on("call:declined", onDeclined)
    s.on("disconnect", onDisconnect)
    s.on("connect", onConnect)
    this.detach = () => {
      s.off("call:peer-joined", onPeerJoined)
      s.off("call:peer-left", onPeerLeft)
      s.off("call:peer-media", onPeerMedia)
      s.off("call:peer-captions", onPeerCaptions)
      s.off("rtc:signal", onSignal)
      s.off("call:ended", onEnded)
      s.off("call:declined", onDeclined)
      s.off("disconnect", onDisconnect)
      s.off("connect", onConnect)
    }
  }

  private send(to: string, data: RtcSignal) {
    this.socket.emit("rtc:signal", { callId: this.callId, to, data })
  }

  // --- peer connections --------------------------------------------------------------------------

  /** Returns the link to `id`, creating it (and adding our tracks) if needed. */
  private connect(id: string): PeerLink {
    const existing = this.links.get(id)
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    const link: PeerLink = {
      id,
      pc,
      polite: (this.selfId ?? "") < id,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      audioSender: null,
      videoSender: null,
      tracks: new Map(),
      restartTimer: null,
    }
    this.links.set(id, link)

    pc.onnegotiationneeded = async () => {
      try {
        link.makingOffer = true
        await pc.setLocalDescription()
        if (pc.localDescription) this.sendDescription(link, pc.localDescription)
      } catch (err) {
        console.warn("[rtc] negotiation failed", err)
      } finally {
        link.makingOffer = false
      }
    }

    pc.onicecandidate = ({ candidate }) => {
      // end-of-candidates (null) is not relayed: every browser copes without it
      if (candidate) this.send(id, { candidate: candidate.toJSON() })
    }

    pc.ontrack = ({ track }) => {
      const previous = link.tracks.get(track.kind)
      if (previous === track) return
      link.tracks.set(track.kind, track)
      track.addEventListener("ended", () => {
        if (link.tracks.get(track.kind) !== track) return
        link.tracks.delete(track.kind)
        this.emitStream(link)
      })
      this.emitStream(link)
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") this.restartIce(link)
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (link.restartTimer) {
        clearTimeout(link.restartTimer)
        link.restartTimer = null
      }
      if (state === "failed") this.restartIce(link)
      else if (state === "disconnected") {
        // often recovers by itself (network blip); otherwise force a restart
        link.restartTimer = setTimeout(() => {
          link.restartTimer = null
          if (pc.connectionState === "disconnected") this.restartIce(link)
        }, DISCONNECTED_GRACE_MS)
      } else if (state === "connected") this.applyBitrateCaps()
      this.emit("connection-state", id, state)
    }

    if (this.audioTrack)
      link.audioSender = pc.addTrack(this.audioTrack, this.outStream)
    const video = this.screenTrack ?? this.cameraTrack
    if (video) link.videoSender = pc.addTrack(video, this.outStream)
    this.emit("connection-state", id, pc.connectionState)
    return link
  }

  private disconnect(id: string) {
    const link = this.links.get(id)
    if (!link) return
    this.links.delete(id)
    if (link.restartTimer) clearTimeout(link.restartTimer)
    const { pc } = link
    pc.onnegotiationneeded = null
    pc.onicecandidate = null
    pc.ontrack = null
    pc.oniceconnectionstatechange = null
    pc.onconnectionstatechange = null
    pc.close()
    link.tracks.clear()
  }

  private sendDescription(
    link: PeerLink,
    description: RTCSessionDescription | RTCSessionDescriptionInit
  ) {
    this.send(link.id, {
      description: { type: description.type, sdp: description.sdp },
    })
  }

  /** Perfect negotiation, receiving side (MDN). */
  private async handleSignal(link: PeerLink, data: RtcSignal) {
    const { pc } = link
    try {
      if ("description" in data) {
        const description = data.description
        const readyForOffer =
          !link.makingOffer &&
          (pc.signalingState === "stable" || link.isSettingRemoteAnswerPending)
        const offerCollision = description.type === "offer" && !readyForOffer
        link.ignoreOffer = !link.polite && offerCollision
        if (link.ignoreOffer) return

        link.isSettingRemoteAnswerPending = description.type === "answer"
        await pc.setRemoteDescription(description)
        link.isSettingRemoteAnswerPending = false
        if (description.type === "offer") {
          await pc.setLocalDescription()
          if (pc.localDescription)
            this.sendDescription(link, pc.localDescription)
        }
      } else if ("candidate" in data && data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate)
        } catch (err) {
          if (!link.ignoreOffer) throw err
        }
      }
    } catch (err) {
      link.isSettingRemoteAnswerPending = false
      if (pc.signalingState !== "closed")
        console.warn("[rtc] signaling error", err)
    }
  }

  private restartIce(link: PeerLink) {
    const { pc } = link
    if (pc.signalingState === "closed") return
    // triggers negotiationneeded with an ICE-restart offer (perfect negotiation does the rest)
    if (typeof pc.restartIce === "function") pc.restartIce()
  }

  private emitStream(link: PeerLink) {
    // a fresh MediaStream so React sees the change and media elements re-bind `srcObject`
    this.emit("stream", link.id, new MediaStream([...link.tracks.values()]))
  }

  // --- local tracks ------------------------------------------------------------------------------

  private async syncVideo() {
    const track = this.screenTrack ?? this.cameraTrack
    await Promise.all(
      [...this.links.values()].map((link) =>
        this.sendTrack(link, "video", track)
      )
    )
    this.applyBitrateCaps()
  }

  private async sendTrack(
    link: PeerLink,
    kind: "audio" | "video",
    track: MediaStreamTrack | null
  ) {
    const key = kind === "audio" ? "audioSender" : "videoSender"
    const sender = link[key]
    try {
      if (sender) {
        // no renegotiation: the remote receiver keeps its track, which just mutes / unmutes
        await sender.replaceTrack(track)
      } else if (track && link.pc.signalingState !== "closed") {
        // first track of this kind: reuses a recv-only transceiver if any, renegotiates
        link[key] = link.pc.addTrack(track, this.outStream)
      }
    } catch (err) {
      console.warn(`[rtc] could not send ${kind}`, err)
    }
  }

  /**
   * Mesh uploads one copy of our video per peer: cap the bitrate as the call grows so a
   * 6-person call stays usable on an ordinary uplink.
   */
  private applyBitrateCaps() {
    const peers = this.links.size
    const maxBitrate = this.screenTrack
      ? peers <= 2
        ? 1_500_000
        : 800_000
      : peers <= 1
        ? 1_200_000
        : peers <= 3
          ? 600_000
          : 350_000
    for (const link of this.links.values()) {
      const sender = link.videoSender
      if (!sender?.track) continue
      const params = sender.getParameters()
      if (!params.encodings?.length) continue // before negotiation (Firefox): retried on "connected"
      if (params.encodings.every((e) => e.maxBitrate === maxBitrate)) continue
      for (const encoding of params.encodings) encoding.maxBitrate = maxBitrate
      sender.setParameters(params).catch(() => undefined)
    }
  }

  private teardown() {
    this.closed = true
    this.joined = false
    this.detach?.()
    this.detach = null
    for (const id of [...this.links.keys()]) this.disconnect(id)
    for (const track of this.outStream.getTracks())
      this.outStream.removeTrack(track)
  }

  /** Removes every listener once the owner is done (after `leave()` / `ended`). */
  dispose() {
    this.leave()
    this.clearHandlers()
  }
}
