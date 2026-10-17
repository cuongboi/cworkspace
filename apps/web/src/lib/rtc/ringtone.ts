/**
 * Incoming-call ringtone synthesized with WebAudio (no audio assets). Browsers may keep the
 * AudioContext suspended until the user has interacted with the page: it then rings silently
 * (the visual prompt still shows) and vibrates where supported.
 */
export class Ringtone {
  private ctx: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  start() {
    if (this.ctx || typeof window === "undefined") return
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctx) return
    try {
      this.ctx = new Ctx()
    } catch {
      return
    }
    const ring = () => {
      const ctx = this.ctx
      if (!ctx) return
      if (ctx.state === "suspended") void ctx.resume().catch(() => undefined)
      const t = ctx.currentTime + 0.05
      // two short two-note chimes, then silence until the next cycle
      this.note(659.25, t)
      this.note(880, t + 0.18)
      this.note(659.25, t + 0.6)
      this.note(880, t + 0.78)
      navigator.vibrate?.([300, 150, 300])
    }
    ring()
    this.timer = setInterval(ring, 3000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    void this.ctx?.close().catch(() => undefined)
    this.ctx = null
    navigator.vibrate?.(0)
  }

  private note(frequency: number, at: number, duration = 0.16) {
    const ctx = this.ctx
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + duration + 0.05)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  }
}
