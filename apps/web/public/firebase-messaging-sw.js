/* Service worker: background push (FCM data messages from apps/api/src/server/push.ts) and PWA install. */

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

// a fetch handler makes Android Chrome offer "Install app"; requests go straight to the network
self.addEventListener("fetch", () => {})

function readPayload(event) {
  try {
    const json = event.data ? event.data.json() : {}
    return json.data || json
  } catch {
    return {}
  }
}

async function appIsFocused() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  return windows.some((c) => c.focused && c.visibilityState === "visible")
}

self.addEventListener("push", (event) => {
  const data = readPayload(event)
  event.waitUntil(
    (async () => {
      if (data.kind === "dismiss") {
        const shown = await self.registration.getNotifications({ tag: data.tag })
        shown.forEach((n) => n.close())
        return
      }
      if (!data.title) return
      // the open app already shows it in-app (toasts, ringing dialog, badges)
      if (await appIsFocused()) return
      const isCall = data.kind === "call"
      await self.registration.showNotification(data.title, {
        body: data.body || "",
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        icon: "/icon-192.png",
        badge: "/badge-72.png",
        data: { url: data.url || "/", callId: data.callId || "" },
        // Android / desktop only: iOS shows no buttons, a tap opens the app's ringing card
        actions: isCall && data.callId
          ? [
              { action: "accept", title: "Accept" },
              { action: "decline", title: "Decline" },
            ]
          : [],
        requireInteraction: isCall,
        vibrate: isCall ? [400, 200, 400, 200, 400] : [100],
      })
    })(),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const { url: path = "/", callId } = event.notification.data || {}
  if (event.action === "decline" && callId) {
    event.waitUntil(
      fetch(`/api/calls/${encodeURIComponent(callId)}/decline`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).catch(() => {}),
    )
    return
  }
  const target = event.action === "accept" && callId ? `/call/${encodeURIComponent(callId)}` : path
  const url = new URL(target, self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const client = windows.find((c) => new URL(c.url).origin === self.location.origin)
      if (client) {
        await client.focus()
        if (client.url !== url && "navigate" in client) await client.navigate(url).catch(() => {})
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
