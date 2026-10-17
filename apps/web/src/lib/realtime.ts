import type {
  AckResult,
  ClientAckData,
  ClientEvent,
  ClientPayload,
  ClientRequest,
  ServerToClientEvents,
} from "@/lib/realtime-events"

/**
 * WebSocket client for `/ws` (protocol: `@app/shared/realtime-events`). Exposes the subset of the
 * socket.io-client API the app was written against — `on/off/emit`, `timeout(ms).emitWithAck`,
 * `id`, `connected`, `connect`/`disconnect` events — and reconnects with backoff.
 */

type LifecycleEvents = {
  connect: () => void
  disconnect: () => void
  /** reconnected after a drop: events may have been missed */
  reconnect: () => void
}
type Events = ServerToClientEvents & LifecycleEvents
type Listener = (payload: never) => void

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const reviveDates = (_key: string, value: unknown) =>
  typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value

const MAX_BACKOFF_MS = 15_000

export class RealtimeClient {
  /** Connection id assigned by the server (`hello`); null while disconnected. */
  id: string | null = null
  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<Listener>>()
  private pending = new Map<
    number,
    { resolve: (res: AckResult<unknown>) => void; timer: number }
  >()
  private nextReqId = 1
  private attempts = 0
  private everConnected = false
  private closed = false
  private retryTimer: number | undefined
  private readonly url: string

  constructor(url = defaultUrl()) {
    this.url = url
    this.open()
  }

  get connected() {
    return this.id !== null && this.ws?.readyState === WebSocket.OPEN
  }

  on<E extends keyof Events>(event: E, listener: Events[E]) {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(listener as unknown as Listener)
    return this
  }

  off<E extends keyof Events>(event: E, listener: Events[E]) {
    this.listeners.get(event)?.delete(listener as unknown as Listener)
    return this
  }

  /** Fire-and-forget. Dropped while disconnected (like a volatile Socket.IO emit). */
  emit<E extends ClientEvent>(event: E, payload: ClientPayload<E>) {
    if (this.connected) this.ws!.send(JSON.stringify({ e: event, d: payload }))
  }

  /** `socket.timeout(ms).emitWithAck(event, payload)`: rejects when no ack arrives in time. */
  timeout(ms: number) {
    return {
      emitWithAck: <E extends ClientRequest>(
        event: E,
        payload: ClientPayload<E>
      ) => this.request(event, payload, ms),
    }
  }

  request<E extends ClientRequest>(
    event: E,
    payload: ClientPayload<E>,
    timeoutMs = 10_000
  ): Promise<AckResult<ClientAckData<E>>> {
    return new Promise((resolve, reject) => {
      const id = this.nextReqId++
      const send = () => {
        this.off("connect", send)
        if (!this.pending.has(id)) return
        this.ws!.send(JSON.stringify({ e: event, d: payload, id }))
      }
      const timer = window.setTimeout(() => {
        this.off("connect", send)
        this.pending.delete(id)
        reject(new Error("Request timed out"))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: resolve as (res: AckResult<unknown>) => void,
        timer,
      })
      // like Socket.IO, a request made while (re)connecting is sent once connected
      if (this.connected) send()
      else this.on("connect", send)
    })
  }

  close() {
    this.closed = true
    window.clearTimeout(this.retryTimer)
    this.ws?.close()
    this.ws = null
  }

  private open() {
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onmessage = (msg) => this.receive(String(msg.data))
    ws.onclose = () => {
      if (this.ws !== ws) return
      const wasConnected = this.id !== null
      this.id = null
      // in-flight requests can't be answered by a new connection
      if (wasConnected)
        for (const [id, req] of this.pending) {
          window.clearTimeout(req.timer)
          req.resolve({ ok: false, error: "Connection lost" })
          this.pending.delete(id)
        }
      if (wasConnected) this.fire("disconnect", undefined)
      if (this.closed) return
      // exponential backoff with jitter; also retries a refused (unauthenticated) upgrade
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempts++)
      this.retryTimer = window.setTimeout(
        () => this.open(),
        delay * (0.5 + Math.random() / 2)
      )
    }
  }

  private receive(text: string) {
    let frame: {
      e?: string
      d?: unknown
      ack?: number
      res?: AckResult<unknown>
    }
    try {
      frame = JSON.parse(text, reviveDates)
    } catch {
      return
    }
    if (typeof frame.ack === "number") {
      const req = this.pending.get(frame.ack)
      if (!req) return
      this.pending.delete(frame.ack)
      window.clearTimeout(req.timer)
      req.resolve(frame.res ?? { ok: false, error: "Malformed reply" })
      return
    }
    if (frame.e === "hello") {
      this.id = (frame.d as { socketId: string }).socketId
      this.attempts = 0
      this.fire("connect", undefined)
      if (this.everConnected) this.fire("reconnect", undefined)
      this.everConnected = true
      return
    }
    if (frame.e) this.fire(frame.e, frame.d)
  }

  private fire(event: string, payload: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      try {
        listener(payload as never)
      } catch (err) {
        console.error(`[realtime] ${event} listener`, err)
      }
    }
  }
}

function defaultUrl() {
  const { protocol, host } = window.location
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/ws`
}
