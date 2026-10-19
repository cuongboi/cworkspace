import {
  GoogleGenAI,
  type LiveConnectConfig,
  type LiveServerMessage,
  type Session,
} from "@google/genai"
import { ApiError, api } from "@/lib/api-client"
import type { CaptionLang } from "@/lib/realtime-events"

/**
 * Building blocks of live captions (Gemini Live, straight from the browser):
 *   - `CaptionTokens`: the pair of ephemeral tokens from `/api/calls/:id/caption-tokens`,
 *   - `PcmTap`: a MediaStreamTrack as 16 kHz PCM16 chunks of 100 ms (+ their loudness),
 *   - `UtteranceLog`: utterances of one speaker, as marked by their voice detection,
 *   - `CaptionStream`: one Gemini Live session (Transcribe Live or Live Translate).
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
/** translation of the last utterance is final when nothing new arrived this long */
const TRANSLATE_IDLE_MS = 2_000
/**
 * Verb-final languages (ja, ko, de…) finish a sentence after the next one started: output keeps
 * going to the previous utterance until its sentence ends, at most this long.
 */
const CARRY_MS = 2_500
/** an ended utterance whose echo stopped short (dropped words) is left behind after this long */
const ALIGN_TIMEOUT_MS = 6_000
/** a token must open its session within a minute of being issued (with some margin) */
const TOKEN_FRESH_MS = 50_000

const SENTENCE_END = /[.!?。！？…][\s"'」』）)]*$/u
// Transcribe Live puts spaces between Japanese/Chinese words ("に ついて 話します")
const CJK_SPACE =
  /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。])/gu
const tidy = (text: string) => text.replace(CJK_SPACE, "")
const alignLength = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").length

// --- tokens ----------------------------------------------------------------------------------

type Bundle = {
  lang: CaptionLang
  transcribe: Grant | null
  translate: Grant
  translateLeft: number
  freshUntil: number
}

/**
 * The server hands out tokens in pairs (transcribe our mic + translate the others into our
 * language). Fetched when we join; a new pair is fetched whenever a session needs one that is
 * used up or too old to open a session.
 */
export class CaptionTokens {
  private readonly callId: string
  private bundle: Bundle | null = null
  private inflight: Promise<Bundle> | null = null
  lang: CaptionLang = "en"

  constructor(callId: string) {
    this.callId = callId
  }

  /** at join: the first sessions open without waiting for a round trip */
  prefetch() {
    void this.fetch().catch(() => undefined)
  }

  clear() {
    this.bundle = null
  }

  async take(mode: CaptionMode): Promise<Grant> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const b = this.usable() ?? (await this.fetch())
      // fetched for a language we no longer use (an in-flight request when it changed)
      if (b.lang !== this.lang) continue
      if (mode === "transcribe" && b.transcribe) {
        const grant = b.transcribe
        b.transcribe = null
        return grant
      }
      if (mode === "translate" && b.translateLeft > 0) {
        b.translateLeft--
        return b.translate
      }
      if (this.bundle === b) this.bundle = null
    }
    throw new Error("no caption token left")
  }

  private usable() {
    const b = this.bundle
    return b && b.lang === this.lang && Date.now() < b.freshUntil ? b : null
  }

  private fetch(): Promise<Bundle> {
    const lang = this.lang
    if (this.inflight) return this.inflight
    const issued = Date.now()
    const request = api
      .post<{ transcribe: Grant; translate: Grant }>(
        `/api/calls/${encodeURIComponent(this.callId)}/caption-tokens`,
        { lang }
      )
      .then((res) => {
        const bundle: Bundle = {
          lang,
          transcribe: res.transcribe,
          translate: res.translate,
          translateLeft: res.translate.uses,
          freshUntil: issued + TOKEN_FRESH_MS,
        }
        if (lang === this.lang) this.bundle = bundle
        return bundle
      })
      .finally(() => {
        if (this.inflight === request) this.inflight = null
      })
    this.inflight = request
    return request
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

// --- utterances ------------------------------------------------------------------------------

/** An utterance of one speaker, as decided by their voice detection. */
export type Utterance = {
  id: string
  startAt: number
  endAt: number | null
  /** latest original text (Transcribe Live, in the speaker's browser) */
  source: string
}

export class UtteranceLog {
  private list: Utterance[] = []

  start(id: string) {
    if (this.get(id)) return
    this.list.push({ id, startAt: Date.now(), endAt: null, source: "" })
    if (this.list.length > 50) this.list.shift()
  }

  end(id: string) {
    const u = this.get(id)
    if (u && u.endAt === null) u.endAt = Date.now()
  }

  setSource(id: string, text: string) {
    const u = this.get(id)
    if (u) u.source = text
  }

  get(id: string) {
    return this.list.find((u) => u.id === id) ?? null
  }

  /** the utterance after `id`, once it has started */
  next(id: string) {
    const i = this.list.findIndex((u) => u.id === id)
    return i >= 0 ? (this.list[i + 1] ?? null) : null
  }
}

// --- one Gemini Live session -----------------------------------------------------------------

export type StreamSegment = { utteranceId: string; text: string; final: boolean }

export interface StreamOwner {
  readonly tokens: CaptionTokens
  readonly log: UtteranceLog
  emit(stream: CaptionStream, segment: StreamSegment): void
  /** the session gave up after repeated failures */
  failed(stream: CaptionStream, reason: string): void
  /** captions are not configured on the server (or the call refused them) */
  unavailable(message: string): void
  streamStatusChanged(): void
}

type Pending = { id: string; text: string; interim: string; ended: boolean }

/**
 * One Gemini Live session. Measured behavior of the two models (manual activity detection):
 *   Transcribe Live: interimInputTranscription = the whole utterance so far (replaces), then
 *     after activityEnd the final inputTranscription and generationComplete.
 *   Live Translate:  inputTranscription / outputTranscription chunks (append), each output just
 *     after the input it translates; no turnComplete, and turn boundaries don't cut its output.
 *     So its chunks are placed by text: the words it echoes (inputTranscription) are lined up
 *     against the speaker's transcript of each utterance by character position.
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

  // translate: one long activity while the speaker talks (+ tail), chunks placed by text
  private windowOpen = false
  /** utterance the translator's echoed input is currently in, and how far (aligned chars) */
  private inputId: string | null = null
  private inputPos = 0
  /** translation text per utterance not final yet */
  private texts = new Map<string, string>()
  /** previous utterance still finishing its sentence */
  private carry: { id: string; at: number } | null = null
  private dirty = new Set<string>()
  private idleTimer: number | undefined

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
      ? this.windowOpen || this.texts.size > 0
      : this.active || this.queue.length > 0
  }

  /** translate: still receiving audio (the utterance or its tail) */
  get listening() {
    return this.windowOpen
  }

  /** Starts an utterance. A session that wasn't ready joins at the next one. */
  begin(id: string) {
    if (!this.session) return false
    if (this.mode === "translate") {
      window.clearTimeout(this.idleTimer)
      if (this.windowOpen) return false
      this.windowOpen = true
      if (!this.inputId) {
        this.inputId = id
        this.inputPos = 0
      }
      this.session.sendRealtimeInput({ activityStart: {} })
      return true
    }
    if (this.active) return false
    this.active = true
    this.queue.push({ id, text: "", interim: "", ended: false })
    this.session.sendRealtimeInput({ activityStart: {} })
    return true
  }

  /** transcribe: the utterance ended, its turn ends */
  end() {
    if (this.mode === "translate" || !this.active) return
    this.active = false
    this.session?.sendRealtimeInput({ activityEnd: {} })
    const last = this.queue.at(-1)
    if (last) last.ended = true
    this.armFallback()
  }

  /** translate: the speaker has been quiet for the tail; the translation can settle */
  closeWindow() {
    if (!this.windowOpen) return
    this.windowOpen = false
    this.session?.sendRealtimeInput({ activityEnd: {} })
    this.armIdle()
  }

  send(base64: string) {
    if (this.mode === "translate" ? !this.windowOpen : !this.active) return
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
      if (c.inputTranscription?.text) this.onEcho(c.inputTranscription.text)
      if (c.outputTranscription?.text) {
        this.onTranslation(c.outputTranscription.text)
        if (!this.windowOpen) this.armIdle()
      }
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

  // --- translate: place chunks by text -------------------------------------------------------

  /** The translator heard `text`: move on to the next utterance once its transcript is covered. */
  private onEcho(text: string) {
    const now = Date.now()
    const log = this.owner.log
    for (; ;) {
      const current = this.inputId ? log.get(this.inputId) : null
      const next = this.inputId ? log.next(this.inputId) : null
      if (!current || !next) break
      const length = alignLength(current.source)
      const covered =
        length > 0 && this.inputPos >= length - Math.max(2, length * 0.15)
      const stale =
        current.endAt !== null && now - current.endAt > ALIGN_TIMEOUT_MS
      if (!covered && !stale) break
      this.startCarry(current.id)
      this.inputId = next.id
      this.inputPos = 0
    }
    this.inputPos += alignLength(text)
  }

  private onTranslation(text: string) {
    const carry = this.carry
    if (carry && Date.now() - carry.at < CARRY_MS) {
      this.append(carry.id, text)
      if (SENTENCE_END.test(this.texts.get(carry.id) ?? "")) {
        this.carry = null
        this.commitTranslation(carry.id)
      }
      return
    }
    if (carry) {
      this.carry = null
      this.commitTranslation(carry.id)
    }
    if (this.inputId) this.append(this.inputId, text)
  }

  private startCarry(id: string) {
    if (this.carry) this.commitTranslation(this.carry.id)
    this.carry = null
    if (SENTENCE_END.test(this.texts.get(id) ?? "")) this.commitTranslation(id)
    else this.carry = { id, at: Date.now() }
  }

  private append(id: string, text: string) {
    this.texts.set(id, (this.texts.get(id) ?? "") + text)
    this.dirty.add(id)
    this.schedulePartial()
  }

  private commitTranslation(id: string) {
    const text = this.texts.get(id)?.trim()
    this.texts.delete(id)
    this.dirty.delete(id)
    if (text) this.owner.emit(this, { utteranceId: id, text, final: true })
  }

  /** quiet after the tail: everything translated so far is final */
  private armIdle() {
    window.clearTimeout(this.idleTimer)
    this.idleTimer = window.setTimeout(() => {
      if (this.windowOpen) return
      this.carry = null
      for (const id of [...this.texts.keys()]) this.commitTranslation(id)
      // the next window starts at the next utterance
      this.inputId = null
      this.inputPos = 0
    }, TRANSLATE_IDLE_MS)
  }

  // --- both ----------------------------------------------------------------------------------

  private schedulePartial() {
    if (this.flushTimer !== undefined) return
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = undefined
      if (this.mode === "translate") {
        for (const id of this.dirty) {
          const text = this.texts.get(id)?.trim()
          if (text) this.owner.emit(this, { utteranceId: id, text, final: false })
        }
        this.dirty.clear()
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
    window.clearTimeout(this.idleTimer)
    this.active = false
    this.windowOpen = false
    for (const p of this.queue.splice(0)) {
      const text = this.textOf(p)
      if (text) this.owner.emit(this, { utteranceId: p.id, text, final: true })
    }
    this.carry = null
    for (const id of [...this.texts.keys()]) this.commitTranslation(id)
    this.inputId = null
    this.inputPos = 0
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
