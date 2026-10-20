/* Service worker: background push (FCM data messages from apps/api/src/server/push.ts) and PWA install. */

const CACHE = "cw-shell-v1"
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/badge-72.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  // first install has nothing to replace; updates wait for SKIP_WAITING so open tabs keep their chunks
  if (!self.registration.active) self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith("cw-shell-") && k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting()
})

async function put(request, response) {
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  // data, auth and sockets always hit the network
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws") ||
    url.pathname.startsWith("/openapi")
  )
    return

  if (request.mode === "navigate") {
    // network-first so a deploy shows up on reload; offline falls back to the SPA shell
    event.respondWith(
      fetch(request)
        .then((res) => put("/index.html", res))
        .catch(async () => (await caches.match("/index.html")) || Response.error()),
    )
    return
  }

  if (url.pathname.startsWith("/assets/")) {
    // Vite hashes these file names, so a cached copy never goes stale
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => put(request, res))))
    return
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => put(request, res))
        .catch(() => hit || Response.error())
      return hit || network
    }),
  )
})

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
