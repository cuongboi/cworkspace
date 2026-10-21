import { CHUNK_MS, PcmTap } from "./caption-stream"

/**
 * Sends our microphone to the server for live captions while we speak: binary `/ws` frames of
 * `[n][callId][PCM16]`. The server transcribes and translates (one provider session per call,
 * billed by the hour), so silence is not sent: a loudness gate opens on speech, keeps a little
 * audio from before it (the first syllable) and closes after a short hangover.
 * Runs while anyone in the call (us included) reads captions and we aren't muted.
 */

export type CaptionerOptions = {
  callId: string
  /** sends a binary frame; false when the socket is down */
  send: (frame: ArrayBuffer) => boolean
  /** our utterance ended (mute / stop): the server finalizes it now */
  end: () => void
}

/** loud chunks in a row that open the gate */
const START_CHUNKS = 2
/** silence after speech still sent, so the provider hears the end of the utterance */
const HANGOVER_MS = 600
/** audio kept from before speech was detected */
const PREROLL_CHUNKS = 3
const MIN_THRESHOLD = 0.012

export class Captioner {
  private readonly opts: CaptionerOptions
  private readonly prefix: Uint8Array
  private tap: PcmTap
  private track: MediaStreamTrack | null = null
  private muted = true
  private active = false

  private open = false
  private loudChunks = 0
  private silentMs = 0
  private noiseFloor = 0.005
  private preroll: ArrayBuffer[] = []

  constructor(opts: CaptionerOptions) {
    this.opts = opts
    const id = new TextEncoder().encode(opts.callId)
    this.prefix = new Uint8Array([id.length, ...id])
    this.tap = new PcmTap((pcm, rms) => this.onChunk(pcm, rms))
  }

  /** `active` = someone in the call reads captions */
  configure(active: boolean) {
    this.active = active
    this.reconcile()
  }

  /** The live microphone track (null = none); captions follow it across device changes. */
  setTrack(track: MediaStreamTrack | null, muted: boolean) {
    this.muted = muted || !track
    this.track = track
    this.reconcile()
  }

  stop() {
    this.active = false
    this.reconcile()
    this.tap.close()
    this.tap = new PcmTap((pcm, rms) => this.onChunk(pcm, rms))
  }

  private reconcile() {
    const want = this.active && this.track !== null && !this.muted
    if (!want) this.close()
    this.tap.setTrack(want ? this.track : null)
  }

  private onChunk(pcm: ArrayBuffer, rms: number) {
    if (this.muted || !this.active) return this.close()
    const threshold = Math.max(MIN_THRESHOLD, this.noiseFloor * 3)
    const loud = rms > threshold

    if (!this.open) {
      if (!loud) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05
      this.loudChunks = loud ? this.loudChunks + 1 : 0
      this.preroll.push(pcm)
      if (this.preroll.length > PREROLL_CHUNKS) this.preroll.shift()
      if (this.loudChunks < START_CHUNKS) return
      this.open = true
      this.silentMs = 0
      for (const chunk of this.preroll.splice(0)) this.send(chunk)
      return
    }

    this.send(pcm)
    this.silentMs = loud ? 0 : this.silentMs + CHUNK_MS
    // the server ends the utterance itself once frames stop coming
    if (this.silentMs >= HANGOVER_MS) {
      this.open = false
      this.loudChunks = 0
    }
  }

  private send(pcm: ArrayBuffer) {
    const frame = new Uint8Array(this.prefix.length + pcm.byteLength)
    frame.set(this.prefix)
    frame.set(new Uint8Array(pcm), this.prefix.length)
    this.opts.send(frame.buffer)
  }

  /** stops sending; a cut-off utterance is finalized at once */
  private close() {
    this.preroll = []
    this.loudChunks = 0
    if (!this.open) return
    this.open = false
    this.opts.end()
  }
}
