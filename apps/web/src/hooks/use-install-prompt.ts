import { useSyncExternalStore } from "react"
import { isStandalone } from "@/lib/push"
import { installPrompt } from "@/lib/pwa"

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

/** `native`: the browser offered install; `ios`: Safari needs Share → Add to Home Screen. */
export function useInstallPrompt() {
  const event = useSyncExternalStore(installPrompt.subscribe, installPrompt.get)
  const mode: "native" | "ios" | null = isStandalone()
    ? null
    : event
      ? "native"
      : isIos()
        ? "ios"
        : null
  return { mode, install: installPrompt.prompt }
}
