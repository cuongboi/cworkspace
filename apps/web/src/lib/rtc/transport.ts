import type {
  CallPeer,
  CallSummary,
  MediaState,
  UserSummary,
} from "@/lib/realtime-events"

/**
 * Media transport of a call, independent of React and of the topology.
 *
 * `CallSession` (and the `useCall` hook on top of it) only ever talk to this interface:
 * they hand over local tracks and receive remote streams + participant events. Today the
 * only implementation is `MeshTransport` (one RTCPeerConnection per remote participant,
 * signaling relayed by Socket.IO, max `MAX_MESH_PARTICIPANTS`).
 *
 * SFU-ready: an SFU implementation (e.g. LiveKit) can replace mesh without touching the UI:
 *  - `join()` would still emit `call:join` (the server would add an SFU access token to the ack),
 *    then connect to the SFU room and publish the local tracks;
 *  - `replaceVideoTrack()` / `replaceAudioTrack()` map to `LocalTrackPublication.replaceTrack`;
 *  - `setScreenShare()` would publish a *separate* screen track instead of swapping the camera;
 *  - remote participants are keyed by the same id the server uses (`CallPeer.socketId`, which an
 *    SFU implementation would use as the participant identity), so `"stream"` / `"participant-*"`
 *    events keep their meaning.
 */

export type JoinResult = {
  call: CallSummary
  peers: CallPeer[]
  title: string
}

export type PeerConnectionState = RTCPeerConnectionState

export type TransportEvents = {
  /** someone joined after us (initial peers come with the `join()` result) */
  "participant-joined": (peer: CallPeer) => void
  "participant-left": (id: string) => void
  "participant-media": (id: string, media: MediaState) => void
  /** the remote media of a participant changed (a fresh MediaStream instance each time) */
  stream: (id: string, stream: MediaStream) => void
  "connection-state": (id: string, state: PeerConnectionState) => void
  /** signaling connection lost; the transport rejoins by itself when it comes back */
  reconnecting: () => void
  /** rejoined after a signaling reconnect: the participant list starts over */
  rejoined: (result: JoinResult) => void
  declined: (user: UserSummary) => void
  /** the call is over for us (ended by the server, or the rejoin failed) */
  ended: (reason: string) => void
}

export interface CallTransport {
  readonly callId: string
  /** Joins the call and starts sending the local tracks (null = receive-only). */
  join(localStream: MediaStream | null, media: MediaState): Promise<JoinResult>
  /** Leaves the call and releases every connection. Idempotent. */
  leave(): void
  /** `leave()` + drops every event handler. */
  dispose(): void
  /** Swaps the camera track (null = camera off). Ignored for sending while a screen is shared. */
  replaceVideoTrack(track: MediaStreamTrack | null): Promise<void>
  /** Swaps the microphone track (device change). */
  replaceAudioTrack(track: MediaStreamTrack | null): Promise<void>
  /** Starts (track) or stops (null) sharing a screen. */
  setScreenShare(track: MediaStreamTrack | null): Promise<void>
  /** Broadcasts our mute / camera / screen state to the other participants. */
  setMedia(media: MediaState): void
  /** Subscribes to an event; returns the unsubscribe function. */
  on<E extends keyof TransportEvents>(
    event: E,
    handler: TransportEvents[E]
  ): () => void
}

/** Tiny typed event emitter shared by transport implementations. */
export class Emitter<
  Events extends { [K in keyof Events]: (...args: never[]) => void },
> {
  private handlers = new Map<keyof Events, Set<Events[keyof Events]>>()

  on<E extends keyof Events>(event: E, handler: Events[E]): () => void {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  protected emit<E extends keyof Events>(
    event: E,
    ...args: Parameters<Events[E]>
  ) {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      try {
        ;(handler as (...a: Parameters<Events[E]>) => void)(...args)
      } catch (err) {
        console.error(`[rtc] ${String(event)} handler failed`, err)
      }
    }
  }

  protected clearHandlers() {
    this.handlers.clear()
  }
}
