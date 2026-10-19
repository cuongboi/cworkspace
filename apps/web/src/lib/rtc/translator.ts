import type { CaptionLang } from "@/lib/realtime-events"
import {
  type CaptionStatus,
  CaptionStream,
  type CaptionTokens,
  RotatingStream,
  type StreamOwner,
  type StreamSegment,
} from "./caption-stream"

/**
 * Translations for the reader: remote speakers' final captions (text, already transcribed in
 * their browser) go to one Gemini Live session told to translate into our language, and come
 * back as text filed under the speaker's utterance id.
 */

export type TranslatorOptions = {
  tokens: CaptionTokens
  onTranslation: (speakerId: string, segment: StreamSegment) => void
  onUnavailable: (message: string) => void
  onStatus: (status: CaptionStatus, reason: string | null) => void
}

/** texts queued while the session is down are dropped beyond this */
const MAX_JOBS = 50

export class Translator implements StreamOwner {
  readonly tokens: CaptionTokens
  private readonly options: TranslatorOptions
  private stream: RotatingStream | null = null
  private lang: CaptionLang | null = null
  /** the session gave up; not reopened until the language changes */
  private failure: string | null = null
  private disabled = false
  private lastStatus = ""
  private seq = 0
  /** job id → whose utterance it is */
  private jobs = new Map<string, { speakerId: string; utteranceId: string }>()

  constructor(options: TranslatorOptions) {
    this.options = options
    this.tokens = options.tokens
  }

  /** `lang` is the language we read (null = captions off) */
  sync(lang: CaptionLang | null) {
    if (lang !== this.lang) {
      this.failure = null
      this.close()
    }
    this.lang = lang
    if (lang) this.tokens.lang = lang
    this.reportStatus()
  }

  /** whether remote lines will get a translation */
  get enabled() {
    return this.lang !== null && !this.disabled && !this.failure
  }

  /** translates a final caption of `speakerId` into our language */
  request(speakerId: string, utteranceId: string, text: string) {
    if (!this.enabled) return
    // opened on the first text to translate, then kept while we read captions
    this.stream ??= new RotatingStream(() => new CaptionStream(this, "translate"))
    const id = `t${this.seq++}`
    this.jobs.set(id, { speakerId, utteranceId })
    if (this.jobs.size > MAX_JOBS) this.jobs.delete(this.jobs.keys().next().value!)
    this.stream.tick()
    this.stream.current.translate(id, text)
  }

  stop() {
    this.sync(null)
  }

  private close() {
    this.stream?.close()
    this.stream = null
    this.jobs.clear()
  }

  // --- StreamOwner ---------------------------------------------------------------------------

  emit(_stream: CaptionStream, s: StreamSegment) {
    const job = this.jobs.get(s.utteranceId)
    if (!job) return
    if (s.final) this.jobs.delete(s.utteranceId)
    this.options.onTranslation(job.speakerId, { ...s, utteranceId: job.utteranceId })
  }

  failed(stream: CaptionStream, reason: string) {
    if (!this.stream?.owns(stream)) return
    if (this.stream.dropNext(stream)) return
    this.close()
    this.failure = reason
    this.reportStatus()
  }

  unavailable(message: string) {
    if (this.disabled) return
    this.disabled = true
    this.close()
    this.reportStatus()
    this.options.onUnavailable(message)
  }

  streamStatusChanged() {
    this.reportStatus()
  }

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
    this.options.onStatus(status, this.failure)
  }
}
