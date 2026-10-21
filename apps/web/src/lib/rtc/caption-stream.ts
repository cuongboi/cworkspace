/**
 * The microphone as 16 kHz mono PCM16 chunks of 100 ms (+ their loudness), the format the
 * server's caption providers take (see `captioner.ts`).
 */

export type CaptionStatus = "off" | "connecting" | "live" | "error"

export const SAMPLE_RATE = 16_000
export const CHUNK_MS = 100

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
 * Streams one audio track as PCM16 chunks. Remote WebRTC tracks only reach Web Audio
 * while they also play in a media element, which `RemoteAudio` does.
 */
export class PcmTap {
  private readonly onChunk: (pcm: ArrayBuffer, rms: number) => void
  private ref: ReturnType<typeof acquireContext> | null = null
  private node: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private track: MediaStreamTrack | null = null
  private closed = false

  constructor(onChunk: (pcm: ArrayBuffer, rms: number) => void) {
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
      ) => this.onChunk(e.data.pcm, e.data.rms)
      // the worklet must be pulled by the graph to run; it outputs nothing audible
      this.node.connect(ref.ctx.destination)
    }
    this.source = ref.ctx.createMediaStreamSource(new MediaStream([this.track]))
    this.source.connect(this.node)
  }
}
