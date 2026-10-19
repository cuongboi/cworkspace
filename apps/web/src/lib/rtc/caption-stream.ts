import {
  GoogleGenAI,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from "@google/genai"
import { LRUCache } from "lru-cache"
import { ApiError, api } from "@/lib/api-client"
import { CAPTION_PAIR, type CaptionLang } from "@/lib/realtime-events"

/**
 * Building blocks of live captions (Gemini Live, straight from the browser):
 *   - `CaptionTokens`: the pair of ephemeral tokens from `/api/calls/:id/caption-tokens`,
 *   - `PcmTap`: a MediaStreamTrack as 16 kHz PCM16 chunks of 100 ms (+ their loudness),
 *   - `CaptionStream`: one Gemini Live session (transcribe our mic, or translate caption text).
 */

export type CaptionMode = "transcribe" | "translate"
export type CaptionStatus = "off" | "connecting" | "live" | "error"

type Grant = {
  token: string
  model: string
  config: LiveConnectConfig
  uses: number
  expiresAt: number
}

export const SAMPLE_RATE = 16_000
export const CHUNK_MS = 100

const MAX_BACKOFF_MS = 15_000
/** consecutive failed opens before a session gives up and reports the error */
const MAX_FAILURES = 3
/** a session that hasn't sent setupComplete by then is treated as failed (it can hang) */
const CONNECT_TIMEOUT_MS = 15_000
/** partial updates per session are coalesced to this interval (finals are sent at once) */
const PARTIAL_INTERVAL_MS = 200
/**
 * Transcribe Live streams at most 10 minutes per session: a successor is opened before that and
 * takes over between utterances (see `rotate`), so no words are cut or said twice.
 */
const ROTATE_AFTER_MS = 8 * 60_000
/** an ended utterance whose final transcript never came is finalized after this long */
const COMMIT_FALLBACK_MS = 4_000
/** a translation whose turn never completed is finalized with what arrived by then */
const TRANSLATE_TIMEOUT_MS = 12_000
/** a token must open its session within a minute of being issued (with some margin) */
const TOKEN_FRESH_MS = 50_000

// Transcribe Live puts spaces between Japanese/Chinese words ("に ついて 話します")
const CJK_SPACE =
  /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。])/gu
const tidy = (text: string) => text.replace(CJK_SPACE, "")

// --- tokens ----------------------------------------------------------------------------------

type Bundle = {
  transcribe: Grant | null
  translate: Grant
  translateLeft: number
}

/**
 * The server hands out tokens in pairs (transcribe our mic + translate the others into our
 * language). A pair is fetched when we join and whenever our language changes, and cached until
 * it is too old to open a session; an expired pair of the current language is renewed at once,
 * so sessions never wait for a round trip. A pair that is used up is fetched again on demand.
 */
export class CaptionTokens {
  private readonly callId: string
  private readonly cache: LRUCache<CaptionLang, Bundle>
  private current: CaptionLang = CAPTION_PAIR[0]
  private stopped = false

  constructor(callId: string) {
    this.callId = callId
    this.cache = new LRUCache<CaptionLang, Bundle>({
      max: 2,
      ttl: TOKEN_FRESH_MS,
      ttlAutopurge: true,
      fetchMethod: (lang) => this.request(lang),
      dispose: (_, lang, reason) => {
        if (reason === "expire" && lang === this.current) this.renew()
      },
    })
  }

  get lang() {
    return this.current
  }

  set lang(lang: CaptionLang) {
    if (lang === this.current) return
    this.cache.delete(this.current)
    this.current = lang
    this.renew()
  }

  /** at join: the first sessions open without waiting for a round trip */
  prefetch() {
    this.stopped = false
    this.renew()
  }

  /** on leave: drops the cached pair and stops renewing */
  clear() {
    this.stopped = true
    this.cache.clear()
  }

  async take(mode: CaptionMode): Promise<Grant> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const lang = this.current
      const b = await this.cache.fetch(lang)
      // fetched for a language we no longer use (it changed during the request)
      if (!b || lang !== this.current) continue
      if (mode === "transcribe" && b.transcribe) {
        const grant = b.transcribe
        b.transcribe = null
        return grant
      }
      if (mode === "translate" && b.translateLeft > 0) {
        b.translateLeft--
        return b.translate
      }
      // used up: the next attempt fetches a new pair
      if (this.cache.peek(lang) === b) this.cache.delete(lang)
    }
    throw new Error("no caption token left")
  }

  private renew() {
    if (this.stopped) return
    void this.cache.fetch(this.current).catch(() => undefined)
  }

  private async request(lang: CaptionLang): Promise<Bundle> {
    const res = await api.post<{ transcribe: Grant; translate: Grant }>(
      `/api/calls/${encodeURIComponent(this.callId)}/caption-tokens`,
      { lang }
    )
    return {
      transcribe: res.transcribe,
      translate: res.translate,
      translateLeft: res.translate.uses,
    }
  }
}

// --- audio -----------------------------------------------------------------------------------

// Downsamples to 16 kHz mono PCM16 in 100 ms chunks, with the chunk's RMS for voice detection.
// Done here rather than with an AudioContext({ sampleRate }) because Firefox can't connect a
// mic source to a resampled context.
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / ${SAMPLE_RATE}; this.pos = 0; this.acc = 0; this.n = 0;
    this.out = new Int16Array(${(SAMPLE_RATE * CHUNK_MS) / 1000}); this.len = 0; this.sq = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.n++; this.pos += 1
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio
        const s = Math.max(-1, Math.min(1, this.acc / this.n)); this.acc = 0; this.n = 0
        this.sq += s * s
        this.out[this.len++] = s < 0 ? s * 0x8000 : s * 0x7fff
        if (this.len === this.out.length) {
          const rms = Math.sqrt(this.sq / this.len)
          this.port.postMessage({ pcm: this.out.buffer.slice(0), rms }); this.len = 0; this.sq = 0
        }
      }
    }
    return true
  }
}
registerProcessor("pcm16", Pcm16)
`

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** One AudioContext for every tap of the call (the mic and each remote speaker). */
let shared: { ctx: AudioContext; ready: Promise<void>; taps: number } | null =
  null

function acquireContext() {
  if (!shared) {
    const ctx = new AudioContext()
    const url = URL.createObjectURL(
      new Blob([WORKLET], { type: "application/javascript" })
    )
    const ready = ctx.audioWorklet
      .addModule(url)
      .finally(() => URL.revokeObjectURL(url))
    // the user already interacted with the call screen (join / unmute), so this is allowed
    void ctx.resume()
    shared = { ctx, ready, taps: 0 }
  }
  shared.taps++
  return shared
}

function releaseContext() {
  if (!shared || --shared.taps > 0) return
  void shared.ctx.close()
  shared = null
}

/**
 * Streams one audio track as base64 PCM16 chunks. Remote WebRTC tracks only reach Web Audio
 * while they also play in a media element, which `RemoteAudio` does.
 */
export class PcmTap {
  private readonly onChunk: (data: string, rms: number) => void
  private ref: ReturnType<typeof acquireContext> | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private track: MediaStreamTrack | null = null
  private closed = false

  constructor(onChunk: (data: string, rms: number) => void) {
    this.onChunk = onChunk
  }

  setTrack(track: MediaStreamTrack | null) {
    if (track?.id === this.track?.id) return
    this.track = track
    void this.wire()
  }

  close() {
    this.closed = true
    this.track = null
    this.source?.disconnect()
    this.node?.disconnect()
    this.node = null
    this.source = null
    if (this.ref) releaseContext()
    this.ref = null
  }

  private async wire() {
    this.source?.disconnect()
    this.source = null
    if (!this.track || this.closed) return
    if (!this.ref) this.ref = acquireContext()
    const ref = this.ref
    await ref.ready.catch(() => undefined)
    if (this.closed || this.ref !== ref || !this.track) return
    if (!this.node) {
      this.node = new AudioWorkletNode(ref.ctx, "pcm16")
      this.node.port.onmessage = (
        e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>
      ) => this.onChunk(toBase64(e.data.pcm), e.data.rms)
      // the worklet must be pulled by the graph to run; it outputs nothing audible
      this.node.connect(ref.ctx.destination)
    }
    this.source = ref.ctx.createMediaStreamSource(new MediaStream([this.track]))
    this.source.connect(this.node)
  }
}

// --- one Gemini Live session -----------------------------------------------------------------

export type StreamSegment = { utteranceId: string; text: string; final: boolean }

export interface StreamOwner {
  readonly tokens: CaptionTokens
  emit(stream: CaptionStream, segment: StreamSegment): void
  /** the session gave up after repeated failures */
  failed(stream: CaptionStream, reason: string): void
  /** captions are not configured on the server (or the call refused them) */
  unavailable(message: string): void
  streamStatusChanged(): void
}

type Pending = { id: string; text: string; interim: string; ended: boolean }
type Job = { id: string; text: string; out: string }

/**
 * One Gemini Live session. Measured behavior of the two models (manual activity detection):
 *   Transcribe Live: interimInputTranscription = the whole utterance so far (replaces), then
 *     after activityEnd the final inputTranscription and generationComplete.
 *   Translate (a general Live model told to translate): each caption text is sent as one turn;
 *     the translation arrives as outputTranscription chunks (append) of the spoken answer, then
 *     turnComplete. One turn at a time, so every answer belongs to the text that was sent.
 */
export class CaptionStream {
  readonly mode: CaptionMode
  status: CaptionStatus = "connecting"
  error: string | null = null
  private readonly owner: StreamOwner
  private session: Session | null = null
  private closed = false
  private failures = 0
  private liveSince = 0
  private retryTimer: number | undefined
  private flushTimer: number | undefined
  private fallbackTimer: number | undefined
  /** bumps on every open, so callbacks of an abandoned connection are ignored */
  private attempt = 0

  // transcribe: utterances sent to this session whose text isn't final yet, oldest first
  private queue: Pending[] = []
  private active = false

  // translate: texts waiting for their turn, and the one being answered
  private jobs: Job[] = []
  private inflight: Job | null = null
  private jobTimer: number | undefined

  constructor(owner: StreamOwner, mode: CaptionMode) {
    this.owner = owner
    this.mode = mode
    void this.open()
  }

  get ready() {
    return this.status === "live" && this.session !== null
  }

  /** time to open a successor (the session nears its streaming limit) */
  get dueForRotation() {
    return this.ready && Date.now() - this.liveSince > ROTATE_AFTER_MS
  }

  /** has audio or text in flight: a successor must wait before taking over */
  get busy() {
    return this.mode === "translate"
      ? this.inflight !== null || this.jobs.length > 0
      : this.active || this.queue.length > 0
  }

  /** Starts an utterance. A session that wasn't ready joins at the next one. */
  begin(id: string) {
    if (!this.session || this.active) return false
    this.active = true
    this.queue.push({ id, text: "", interim: "", ended: false })
    this.session.sendRealtimeInput({ activityStart: {} })
    return true
  }

  /** transcribe: the utterance ended, its turn ends */
  end() {
    if (!this.active) return
    this.active = false
    this.session?.sendRealtimeInput({ activityEnd: {} })
    const last = this.queue.at(-1)
    if (last) last.ended = true
    this.armFallback()
  }

  /** translate: queues `text`; its translation is emitted under `id` */
  translate(id: string, text: string) {
    this.jobs.push({ id, text, out: "" })
    this.pump()
  }

  send(base64: string) {
    if (!this.active) return
    this.session?.sendRealtimeInput({
      audio: { data: base64, mimeType: `audio/pcm;rate=${SAMPLE_RATE}` },
    })
  }

  close() {
    this.closed = true
    window.clearTimeout(this.retryTimer)
    this.attempt++
    this.drop()
    const session = this.session
    this.session = null
    session?.close()
  }

  private setStatus(status: CaptionStatus, error: string | null = null) {
    this.status = status
    this.error = error
    this.owner.streamStatusChanged()
  }

  private async open() {
    const attempt = ++this.attempt
    this.setStatus("connecting")
    let grant: Grant
    try {
      grant = await this.owner.tokens.take(this.mode)
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === "UPSTREAM_ERROR" || err.code === "FORBIDDEN")
      ) {
        if (!this.closed) this.owner.unavailable(err.message)
        return
      }
      return this.fail(
        err instanceof Error ? err.message : "token request failed"
      )
    }
    if (this.closed || attempt !== this.attempt) return

    const ai = new GoogleGenAI({
      apiKey: grant.token,
      httpOptions: { apiVersion: "v1alpha" },
    })
    let session: Session | null = null
    let heard = false
    // an unknown model or an overloaded preview can leave the socket open without ever answering
    const timeout = window.setTimeout(() => {
      if (heard || this.closed || attempt !== this.attempt) return
      this.attempt++
      if (this.session === session) this.session = null
      this.drop()
      session?.close()
      this.fail(`no answer from ${grant.model} (timed out)`)
    }, CONNECT_TIMEOUT_MS)
    try {
      session = await ai.live.connect({
        model: grant.model,
        config: grant.config,
        callbacks: {
          onmessage: (m) => {
            if (attempt !== this.attempt) return
            // a session the server accepts answers with setupComplete first
            if (!heard) {
              heard = true
              window.clearTimeout(timeout)
              this.failures = 0
              this.liveSince = Date.now()
              this.setStatus("live")
            }
            this.onMessage(m)
          },
          onclose: (e) => {
            if (attempt !== this.attempt) return
            window.clearTimeout(timeout)
            if (!session || this.session !== session) return
            this.session = null
            this.drop()
            // closed before the setup was accepted: a config/model problem, not a network blip
            if (heard) this.retry()
            else this.fail(e.reason || `connection closed (${e.code})`)
          },
        },
      })
    } catch (err) {
      window.clearTimeout(timeout)
      if (attempt !== this.attempt) return
      return this.fail(err instanceof Error ? err.message : "connection failed")
    }
    if (this.closed || attempt !== this.attempt) return session.close()
    this.session = session
    this.pump()
  }

  private fail(reason: string) {
    if (this.closed) return
    if (++this.failures >= MAX_FAILURES) {
      this.setStatus("error", reason)
      this.owner.failed(this, reason)
      return
    }
    this.retry()
  }

  private retry() {
    if (this.closed) return
    this.setStatus("connecting")
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures)
    window.clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => void this.open(), delay)
  }

  private onMessage(m: LiveServerMessage) {
    const c = m.serverContent
    if (!c) return
    if (this.mode === "translate") {
      const job = this.inflight
      if (!job) return
      if (c.outputTranscription?.text) {
        job.out += c.outputTranscription.text
        this.schedulePartial()
      }
      if (c.turnComplete) this.finishJob()
      return
    }
    const head = this.queue[0]
    if (!head) return
    if (c.inputTranscription?.text) head.text += c.inputTranscription.text
    if (c.interimInputTranscription?.text !== undefined)
      head.interim = c.interimInputTranscription.text
    if (c.generationComplete || c.turnComplete || c.inputTranscription?.finished)
      return this.commit()
    this.schedulePartial()
  }

  // --- transcribe ----------------------------------------------------------------------------

  private armFallback() {
    window.clearTimeout(this.fallbackTimer)
    if (!this.queue[0]?.ended) return
    this.fallbackTimer = window.setTimeout(
      () => this.commit(),
      COMMIT_FALLBACK_MS
    )
  }

  /** the best text so far: the interim guess covers the whole utterance, so it replaces */
  private textOf(p: Pending) {
    const text = p.text.trim()
    const interim = p.interim.trim()
    return tidy(interim.length > text.length ? interim : text)
  }

  /** the oldest utterance is complete in this session: send it as final */
  private commit() {
    window.clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    const head = this.queue.shift()
    if (head && this.textOf(head))
      this.owner.emit(this, {
        utteranceId: head.id,
        text: this.textOf(head),
        final: true,
      })
    // keep the partial flush going for the next utterance in line
    if (this.queue.length) this.schedulePartial()
    this.armFallback()
  }

  // --- translate ---------------------------------------------------------------------------

  /** sends the next text once the previous answer is complete */
  private pump() {
    if (!this.session || this.inflight || !this.jobs.length) return
    const job = this.jobs.shift()!
    this.inflight = job
    this.session.sendRealtimeInput({ text: job.text })
    window.clearTimeout(this.jobTimer)
    this.jobTimer = window.setTimeout(() => this.finishJob(), TRANSLATE_TIMEOUT_MS)
  }

  private finishJob() {
    window.clearTimeout(this.jobTimer)
    const job = this.inflight
    this.inflight = null
    const text = job?.out.trim()
    if (job && text) this.owner.emit(this, { utteranceId: job.id, text, final: true })
    this.pump()
  }

  // --- both ----------------------------------------------------------------------------------

  private schedulePartial() {
    if (this.flushTimer !== undefined) return
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = undefined
      if (this.mode === "translate") {
        const job = this.inflight
        const text = job?.out.trim()
        if (job && text)
          this.owner.emit(this, { utteranceId: job.id, text, final: false })
        return
      }
      const head = this.queue[0]
      const text = head ? this.textOf(head) : ""
      if (head && text)
        this.owner.emit(this, { utteranceId: head.id, text, final: false })
    }, PARTIAL_INTERVAL_MS)
  }

  /** the session is gone: whatever it had for pending utterances becomes final */
  private drop() {
    window.clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    window.clearTimeout(this.fallbackTimer)
    window.clearTimeout(this.jobTimer)
    this.active = false
    for (const p of this.queue.splice(0)) {
      const text = this.textOf(p)
      if (text) this.owner.emit(this, { utteranceId: p.id, text, final: true })
    }
    // an unanswered text is asked again on the next connection
    if (this.inflight) this.jobs.unshift({ ...this.inflight, out: "" })
    this.inflight = null
    if (this.closed) this.jobs = []
  }
}

/**
 * A stream that is replaced by a fresh session before its limit: the successor opens in the
 * background and takes over when it is live and the current one has nothing in flight.
 */
export class RotatingStream {
  current: CaptionStream
  private next: CaptionStream | null = null
  /** after a failed successor: the current session keeps going for a while */
  private holdUntil = 0
  private readonly create: () => CaptionStream

  constructor(create: () => CaptionStream) {
    this.create = create
    this.current = create()
  }

  /** call regularly (every audio chunk); `force` rotates now (e.g. the glossary changed) */
  tick(force = false) {
    const due = force || (this.current.dueForRotation && Date.now() > this.holdUntil)
    if (!this.next && due)
      this.next = this.create()
    if (this.next?.ready && !this.current.busy) {
      this.current.close()
      this.current = this.next
      this.next = null
    }
  }

  owns(stream: CaptionStream) {
    return stream === this.current || stream === this.next
  }

  /** a successor failed: keep the current session and try again later */
  dropNext(stream: CaptionStream) {
    if (stream !== this.next) return false
    stream.close()
    this.next = null
    this.holdUntil = Date.now() + 60_000
    return true
  }

  close() {
    this.current.close()
    this.next?.close()
    this.next = null
  }
}
