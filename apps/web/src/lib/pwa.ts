import i18n from "@/lib/i18n"
import { toast } from "sonner"

/**
 * PWA bootstrap: one service worker (`public/firebase-messaging-sw.js`, shared
 * with push) caches the app shell, and a waiting update is applied only when
 * the user accepts the toast, so open tabs never lose their lazy chunks.
 */

const SW_URL = "/firebase-messaging-sw.js"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let installEvent: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export const installPrompt = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: () => installEvent,
  async prompt() {
    const event = installEvent
    if (!event) return false
    installEvent = null
    notify()
    await event.prompt()
    return (await event.userChoice).outcome === "accepted"
  },
}

function promptUpdate(worker: ServiceWorker) {
  toast(i18n.t("notifications.pwa.update"), {
    duration: Infinity,
    action: {
      label: i18n.t("notifications.pwa.reload"),
      onClick: () => worker.postMessage({ type: "SKIP_WAITING" }),
    },
  })
}

export function registerServiceWorker() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    installEvent = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener("appinstalled", () => {
    installEvent = null
    notify()
  })

  // the dev server serves unhashed modules; caching them would pin stale code
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return

  let reloading = false
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/" })
      if (reg.waiting && navigator.serviceWorker.controller)
        promptUpdate(reg.waiting)
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing
        worker?.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          )
            promptUpdate(worker)
        })
      })
      // long-lived tabs: look for a new deploy every hour
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
    } catch {
      // unsupported or blocked (private mode): the app works without it
    }
  })
}
