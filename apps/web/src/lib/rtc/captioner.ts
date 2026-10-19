import {
  CAPTION_PAIR,
  type CaptionLang,
  type CaptionMark,
  type CaptionSegment,
} from "@/lib/realtime-events"
import {
  CHUNK_MS,
  type CaptionStatus,
  CaptionStream,
  type CaptionTokens,
  PcmTap,
  RotatingStream,
  type StreamOwner,
  type StreamSegment,
} from "./caption-stream"

/**
 * Live captions of the local speaker: our microphone goes to one Transcribe Live session in the
 * language we speak, and the original text is sent over `/ws` to everyone reading captions.
 *
 * Gemini's voice detection is off; this class detects speech itself and announces each
 * utterance (`call:caption-mark` start/end) so the server can order the transcript by when each
 * utterance started. Readers translate our final text in their own browser.
 * Runs while anyone in the call (us included) reads captions and we aren't muted.
 */

export type { CaptionStatus } from "./caption-stream"

export type CaptionerOptions = {
  tokens: CaptionTokens
  onSegment: (segment: CaptionSegment) => void
  onMark: (mark: CaptionMark) => void
  /** captions are not configured on the server (or the call refused them): stop trying */
  onUnavailable: (message: string) => void
  onStatus: (status: CaptionStatus, reason: string | null) => void
}

// voice detection, in 100 ms chunks
const START_CHUNKS = 2
const END_SILENCE_MS = 700
/** long monologues are cut so captions (and translations) keep flowing */
const MAX_UTTERANCE_MS = 15_000
/** audio kept from before speech was detected, so the first syllable isn't clipped */
const PREROLL_CHUNKS = 3
const MIN_THRESHOLD = 0.012

export class Captioner implements StreamOwner {
  readonly tokens: CaptionTokens
  private opts: CaptionerOptions
  private stream: RotatingStream | null = null
  /** the transcriber gave up; not reopened until the language changes */
  private failure: string | null = null
  private disabled = false
  private tap: PcmTap
  private track: MediaStreamTrack | null = null
  private muted = true
  private active = false
  private lang: CaptionLang = CAPTION_PAIR[0]
  private lastStatus = ""

  // voice detection / utterances
  private readonly prefix = Math.random().toString(36).slice(2, 8)
  private seq = 0
  private current: string | null = null
  private loudChunks = 0
  private silentMs = 0
  private utteranceMs = 0
  private noiseFloor = 0.005
  private preroll: string[] = []

  constructor(opts: CaptionerOptions) {
    this.opts = opts
    this.tokens = opts.tokens
    this.tap = new PcmTap((data, rms) => this.onChunk(data, rms))
  }

  /** `lang` is what we speak; `active` = someone in the call reads captions. */
  configure(lang: CaptionLang, active: boolean) {
    if (lang !== this.lang) {
      this.failure = null
      this.endUtterance()
      this.stream?.close()
      this.stream = null
    }
    this.lang = lang
    this.active = active
    this.reconcile()
  }

  /** The live microphone track (null = none); captions follow it across device changes. */
  setTrack(track: MediaStreamTrack | null, muted: boolean) {
    // muted: stop sending audio rather than sending silence
    this.muted = muted || !track
    if (track?.id !== this.track?.id) {
      this.endUtterance()
      this.track = track
    }
    if (this.muted) this.endUtterance()
    this.reconcile()
  }

  /** The call's glossary changed: the next session (opened now) picks it up from the server. */
  glossaryChanged() {
    this.stream?.tick(true)
  }

  stop() {
    this.active = false
    this.reconcile()
    this.tap.close()
    this.tap = new PcmTap((data, rms) => this.onChunk(data, rms))
  }

  // --- StreamOwner ---------------------------------------------------------------------------

  emit(_stream: CaptionStream, s: StreamSegment) {
    this.opts.onSegment({ ...s, lang: this.lang })
  }

  unavailable(message: string) {
    if (this.disabled) return
    this.disabled = true
    this.reconcile()
    this.opts.onUnavailable(message)
  }

  failed(stream: CaptionStream, reason: string) {
    if (!this.stream?.owns(stream)) return
    if (this.stream.dropNext(stream)) return
    this.stream.close()
    this.stream = null
    this.failure = reason
    this.endUtterance()
    this.reconcile()
  }

  streamStatusChanged() {
    this.reportStatus()
  }

  // -------------------------------------------------------------------------------------------

  private reportStatus() {
    const status: CaptionStatus = this.failure
      ? "error"
      : !this.stream
        ? "off"
        : this.stream.current.status === "live"
          ? "live"
          : "connecting"
    const key = `${status}:${this.failure}`
    if (key === this.lastStatus) return
    this.lastStatus = key
    this.opts.onStatus(status, this.failure)
  }

  private reconcile() {
    // nothing to say while muted: the session is opened on the first unmute
    const want =
      !this.disabled && !this.failure && this.active && this.track && !this.muted
    if (!want && this.stream) {
      this.endUtterance()
      this.stream.close()
      this.stream = null
    }
    if (want && !this.stream) {
      this.tokens.lang = this.lang
      this.stream = new RotatingStream(() => new CaptionStream(this, "transcribe"))
    }
    this.tap.setTrack(want ? this.track : null)
    this.reportStatus()
  }

  // --- voice detection -----------------------------------------------------------------------

  private onChunk(data: string, rms: number) {
    const stream = this.stream
    if (this.muted || !stream) return this.endUtterance()
    stream.tick()
    const threshold = Math.max(MIN_THRESHOLD, this.noiseFloor * 3)
    const loud = rms > threshold

    if (!this.current) {
      if (!loud) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05
      this.loudChunks = loud ? this.loudChunks + 1 : 0
      this.preroll.push(data)
      if (this.preroll.length > PREROLL_CHUNKS) this.preroll.shift()
      if (this.loudChunks < START_CHUNKS) return
      this.startUtterance()
      for (const chunk of this.preroll.splice(0)) this.stream?.current.send(chunk)
      return
    }

    stream.current.send(data)
    this.utteranceMs += CHUNK_MS
    this.silentMs = loud ? 0 : this.silentMs + CHUNK_MS
    if (this.silentMs >= END_SILENCE_MS) this.endUtterance()
    else if (this.utteranceMs >= MAX_UTTERANCE_MS) {
      this.endUtterance()
      this.startUtterance()
    }
  }

  private startUtterance() {
    const id = `${this.prefix}-${this.seq++}`
    this.current = id
    this.silentMs = 0
    this.utteranceMs = 0
    this.loudChunks = 0
    this.stream?.current.begin(id)
    this.opts.onMark({ utteranceId: id, lang: this.lang, state: "start" })
  }

  private endUtterance() {
    this.preroll = []
    this.loudChunks = 0
    const id = this.current
    if (!id) return
    this.current = null
    this.stream?.current.end()
    this.opts.onMark({ utteranceId: id, lang: this.lang, state: "end" })
  }
}
