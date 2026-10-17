/**
 * Voice activity / active speaker detection with WebAudio: one AnalyserNode per participant,
 * sampled a few times per second. Create (and `start()`) it from a user gesture so the
 * AudioContext isn't suspended by autoplay policies.
 *
 * Note: Chrome only feeds remote WebRTC audio into WebAudio when the same stream is also
 * attached to a media element; the call UI plays remote audio through <audio> elements.
 */

export type SpeakerState = {
  speaking: ReadonlySet<string>
  active: string | null
}

type Source = {
  trackId: string
  node: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  buffer: Float32Array<ArrayBuffer>
  level: number
}

const INTERVAL_MS = 150
/** RMS level (0..1) above which someone counts as speaking */
const THRESHOLD = 0.015
/** exponential smoothing so short pauses between words don't flicker */
const SMOOTHING = 0.6

export class SpeakerDetector {
  private ctx: AudioContext | null = null
  private sources = new Map<string, Source>()
  private timer: ReturnType<typeof setInterval> | null = null
  private state: SpeakerState = { speaking: new Set(), active: null }
  private onChange: (state: SpeakerState) => void

  constructor(onChange: (state: SpeakerState) => void) {
    this.onChange = onChange
  }

  start() {
    if (this.ctx || typeof window === "undefined") return
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctx) return
    this.ctx = new Ctx()
    void this.ctx.resume().catch(() => undefined)
    this.timer = setInterval(() => this.tick(), INTERVAL_MS)
  }

  /** Tracks (or stops tracking, with null) the audio of a participant. */
  setStream(id: string, stream: MediaStream | null) {
    const track = stream?.getAudioTracks()[0]
    const current = this.sources.get(id)
    if (current && current.trackId === track?.id) return
    if (current) this.remove(id)
    if (!this.ctx || !stream || !track) return
    try {
      const node = this.ctx.createMediaStreamSource(new MediaStream([track]))
      const analyser = this.ctx.createAnalyser()
      analyser.fftSize = 512
      node.connect(analyser)
      this.sources.set(id, {
        trackId: track.id,
        node,
        analyser,
        buffer: new Float32Array(analyser.fftSize),
        level: 0,
      })
    } catch (err) {
      console.warn("[rtc] speaker detection unavailable", err)
    }
  }

  remove(id: string) {
    const source = this.sources.get(id)
    if (!source) return
    source.node.disconnect()
    source.analyser.disconnect()
    this.sources.delete(id)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const id of [...this.sources.keys()]) this.remove(id)
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    this.state = { speaking: new Set(), active: null }
  }

  private tick() {
    if (this.ctx?.state === "suspended")
      void this.ctx.resume().catch(() => undefined)
    const speaking = new Set<string>()
    let loudest: string | null = null
    let loudestLevel = 0
    for (const [id, source] of this.sources) {
      source.analyser.getFloatTimeDomainData(source.buffer)
      let sum = 0
      for (const v of source.buffer) sum += v * v
      const rms = Math.sqrt(sum / source.buffer.length)
      source.level = source.level * SMOOTHING + rms * (1 - SMOOTHING)
      if (source.level > THRESHOLD) {
        speaking.add(id)
        if (source.level > loudestLevel) {
          loudestLevel = source.level
          loudest = id
        }
      }
    }
    // keep the last active speaker highlighted through silences
    const active =
      loudest ??
      (this.state.active && this.sources.has(this.state.active)
        ? this.state.active
        : null)
    const changed =
      active !== this.state.active ||
      speaking.size !== this.state.speaking.size ||
      [...speaking].some((id) => !this.state.speaking.has(id))
    if (!changed) return
    this.state = { speaking, active }
    this.onChange(this.state)
  }
}
