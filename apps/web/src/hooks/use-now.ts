import { useSyncExternalStore } from "react"

/**
 * The current time as a render-safe value, from one shared clock that ticks every 30s while
 * something is subscribed. Keeps relative labels ("5m ago", "closed") fresh without reading
 * `Date.now()` during render.
 */
const TICK_MS = 30_000
let now = Date.now()
const listeners = new Set<() => void>()
let timer: number | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer === undefined) {
    now = Date.now()
    timer = window.setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}

export function useNow() {
  return useSyncExternalStore(subscribe, () => now)
}
