import type {
  CaptionLang,
  CaptionMark,
  CaptionSegment,
} from "@/lib/realtime-events"
import {
  type CaptionStatus,
  CaptionStream,
  type CaptionTokens,
  PcmTap,
  RotatingStream,
  type StreamOwner,
  type StreamSegment,
  UtteranceLog,
} from "./caption-stream"

/**
 * Translations for the reader: every remote speaker who speaks another language gets one Live
 * Translate session into our language, fed with their audio as we receive it over WebRTC (one
 * track per speaker, so the translation is always attributed to the right person).
 *
 * The speaker's browser announces each utterance (`call:caption-mark`) and sends its transcript;
 * the session listens from an utterance's start until a short tail after it ends, and its output
 * is filed under the speaker's utterance ids (lined up against their transcript).
 */

export type Speaker = {
  /** socket id of the remote participant */
  id: string
  lang: CaptionLang
  stream: MediaStream | null
}

export type TranslatorOptions = {
  tokens: CaptionTokens
  onTranslation: (speakerId: string, segment: StreamSegment) => void
  onUnavailable: (message: string) => void
  onStatus: (status: CaptionStatus, reason: string | null) => void
}

/**
 * Live Translate holds back the last words until more audio arrives: keep streaming the (quiet)
 * speaker this long after their utterance, so the end of every sentence gets translated.
 */
const TRANSLATE_TAIL_MS = 3_000
/** marks travel over /ws, audio over WebRTC: keep enough audio to cover the difference */
const PREROLL_CHUNKS = 5
/** a start mark whose end never came (speaker dropped) is treated as ended */
const MARK_TIMEOUT_MS = 20_000

class SpeakerTranslation implements StreamOwner {
  readonly log = new UtteranceLog()
  readonly lang: CaptionLang
  readonly id: string
  private readonly hub: Translators
  private stream: RotatingStream
  private tap: PcmTap
  private speaking: string | null = null
  private lastMarkAt = 0
  private lastEndAt = 0
  private preroll: string[] = []

  constructor(hub: Translators, speaker: Speaker) {
    this.hub = hub
    this.id = speaker.id
    this.lang = speaker.lang
    this.stream = new RotatingStream(() => new CaptionStream(this, "translate"))
    this.tap = new PcmTap((data) => this.onChunk(data))
    this.setStream(speaker.stream)
  }

  get tokens() {
    return this.hub.tokens
  }

  get status() {
    return this.stream.current
  }

  setStream(stream: MediaStream | null) {
    this.tap.setTrack(stream?.getAudioTracks()[0] ?? null)
  }

  mark(m: CaptionMark) {
    this.lastMarkAt = Date.now()
    if (m.state === "start") {
      this.log.start(m.utteranceId)
      this.speaking = m.utteranceId
      const current = this.stream.current
      const fed = current.listening
      // a fresh window gets the audio heard just before the mark arrived
      if (current.begin(m.utteranceId) && !fed)
        for (const chunk of this.preroll) current.send(chunk)
      return
    }
    this.log.end(m.utteranceId)
    if (this.speaking === m.utteranceId) {
      this.speaking = null
      this.lastEndAt = Date.now()
    }
  }

  source(s: CaptionSegment) {
    this.log.setSource(s.utteranceId, s.text)
  }

  close() {
    this.tap.close()
    this.stream.close()
  }

  private onChunk(data: string) {
    this.preroll.push(data)
    if (this.preroll.length > PREROLL_CHUNKS) this.preroll.shift()
    const now = Date.now()
    if (this.speaking && now - this.lastMarkAt > MARK_TIMEOUT_MS) {
      this.log.end(this.speaking)
      this.speaking = null
      this.lastEndAt = now
    }
    const current = this.stream.current
    // past the tail: the translator has flushed, stop paying for silence
    if (!this.speaking && now - this.lastEndAt >= TRANSLATE_TAIL_MS)
      current.closeWindow()
    current.send(data)
    this.stream.tick()
  }

  // --- StreamOwner ---------------------------------------------------------------------------

  emit(_stream: CaptionStream, s: StreamSegment) {
    this.hub.options.onTranslation(this.id, s)
  }

  failed(stream: CaptionStream, reason: string) {
    if (this.stream.dropNext(stream)) return
    this.hub.failed(this, reason)
  }

  unavailable(message: string) {
    this.hub.unavailable(message)
  }

  streamStatusChanged() {
    this.hub.reportStatus()
  }
}

export class Translators {
  readonly tokens: CaptionTokens
  readonly options: TranslatorOptions
  private speakers = new Map<string, SpeakerTranslation>()
  /** speakers whose translation gave up (id → reason); retried when they change language */
  private failures = new Map<string, { lang: CaptionLang; reason: string }>()
  private disabled = false
  private lastStatus = ""

  constructor(options: TranslatorOptions) {
    this.options = options
    this.tokens = options.tokens
  }

  /**
   * `lang` is the language we read (null = captions off); every speaker of another language
   * gets a translator, the others are closed.
   */
  sync(lang: CaptionLang | null, speakers: Speaker[]) {
    const want = new Map<string, Speaker>()
    if (lang && !this.disabled)
      for (const s of speakers) if (s.lang !== lang) want.set(s.id, s)
    for (const [id, t] of this.speakers) {
      const s = want.get(id)
      if (!s || s.lang !== t.lang) {
        t.close()
        this.speakers.delete(id)
      }
    }
    for (const [id, f] of this.failures)
      if (want.get(id)?.lang !== f.lang) this.failures.delete(id)
    if (lang) this.tokens.lang = lang
    for (const s of want.values()) {
      const t = this.speakers.get(s.id)
      if (t) t.setStream(s.stream)
      else if (!this.failures.has(s.id))
        this.speakers.set(s.id, new SpeakerTranslation(this, s))
    }
    this.reportStatus()
  }

  /** whether `speakerId`'s lines will get a translation */
  translates(speakerId: string) {
    return this.speakers.has(speakerId)
  }

  mark(from: string, m: CaptionMark) {
    this.speakers.get(from)?.mark(m)
  }

  source(from: string, s: CaptionSegment) {
    this.speakers.get(from)?.source(s)
  }

  stop() {
    this.sync(null, [])
  }

  /** @internal */
  failed(t: SpeakerTranslation, reason: string) {
    if (this.speakers.get(t.id) !== t) return
    t.close()
    this.speakers.delete(t.id)
    this.failures.set(t.id, { lang: t.lang, reason })
    this.reportStatus()
  }

  /** @internal */
  unavailable(message: string) {
    if (this.disabled) return
    this.disabled = true
    this.stop()
    this.options.onUnavailable(message)
  }

  /** @internal */
  reportStatus() {
    const [failure] = this.failures.values()
    const streams = [...this.speakers.values()].map((t) => t.status)
    const status: CaptionStatus = failure
      ? "error"
      : streams.some((s) => s.status === "connecting")
        ? "connecting"
        : streams.length
          ? "live"
          : "off"
    const reason = failure?.reason ?? null
    const key = `${status}:${reason}`
    if (key === this.lastStatus) return
    this.lastStatus = key
    this.options.onStatus(status, reason)
  }
}
