import i18n from "@/lib/i18n"
import type { FirebaseOptions } from "firebase/app"
import type { Messaging } from "firebase/messaging"
import { api } from "@/lib/api-client"

/**
 * Background push (Firebase Cloud Messaging). The service worker in
 * `public/firebase-messaging-sw.js` displays the data-only messages the API sends.
 * iOS only delivers web push to an app added to the Home Screen (iOS 16.4+).
 */

type PushConfig =
  | { enabled: false }
  | { enabled: true; vapidKey: string; firebase: FirebaseOptions }

export type PushSupport = "supported" | "ios-needs-install" | "unsupported"

const SW_URL = "/firebase-messaging-sw.js"
const TOKEN_KEY = "push-token"

const storage = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set: (v: string | null) => {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      // private mode: the token is re-registered on next load anyway
    }
  },
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

export async function pushSupport(): Promise<PushSupport> {
  if (isIos() && !isStandalone()) return "ios-needs-install"
  if (!("serviceWorker" in navigator) || !("Notification" in window))
    return "unsupported"
  const { isSupported } = await import("firebase/messaging")
  return (await isSupported()) ? "supported" : "unsupported"
}

let configPromise: Promise<PushConfig> | undefined
export const pushConfig = () =>
  (configPromise ??= api.get<PushConfig>("/api/push/config"))

let messagingPromise: Promise<Messaging> | undefined
async function messaging(config: Extract<PushConfig, { enabled: true }>) {
  messagingPromise ??= (async () => {
    const { getApps, initializeApp } = await import("firebase/app")
    const { getMessaging } = await import("firebase/messaging")
    return getMessaging(getApps()[0] ?? initializeApp(config.firebase))
  })()
  return messagingPromise
}

async function register(config: Extract<PushConfig, { enabled: true }>) {
  const { getToken } = await import("firebase/messaging")
  const serviceWorkerRegistration = await navigator.serviceWorker.register(
    SW_URL,
    { scope: "/" }
  )
  await navigator.serviceWorker.ready
  const token = await getToken(await messaging(config), {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration,
  })
  if (!token) throw new Error(i18n.t("people.push.noToken"))
  const previous = storage.get()
  if (previous && previous !== token)
    await api.delete("/api/push/tokens", { token: previous }).catch(() => {})
  await api.post("/api/push/tokens", { token })
  storage.set(token)
}

/** Asks permission (call from a click: iOS requires a user gesture) and registers. */
export async function enablePush(): Promise<NotificationPermission> {
  const config = await pushConfig()
  if (!config.enabled) throw new Error(i18n.t("people.push.notConfigured"))
  const permission = await Notification.requestPermission()
  if (permission === "granted") await register(config)
  return permission
}

/** Re-registers silently when already allowed (FCM rotates tokens). */
export async function refreshPush() {
  if (!("Notification" in window) || Notification.permission !== "granted")
    return
  if (!storage.get()) return // the user turned it off on this device
  const config = await pushConfig()
  if (config.enabled) await register(config)
}

export function isPushEnabledHere() {
  return (
    "Notification" in window &&
    Notification.permission === "granted" &&
    storage.get() !== null
  )
}

/** Stops pushes to this device (switch off, sign-out). */
export async function disablePush() {
  const token = storage.get()
  if (!token) return
  storage.set(null)
  await api.delete("/api/push/tokens", { token }).catch(() => {})
  const config = await pushConfig().catch(() => null)
  if (config?.enabled) {
    const { deleteToken } = await import("firebase/messaging")
    await deleteToken(await messaging(config)).catch(() => {})
  }
}
