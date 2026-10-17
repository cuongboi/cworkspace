import { useMatch, useNavigate } from "react-router-dom"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { toast } from "sonner"
import { useSocket, useSocketEvent } from "@/hooks/use-socket"
import type { CallKind } from "@/lib/realtime-events"
import { type IncomingCall, IncomingCallCard } from "./incoming-call"

/**
 * Call entry points used across features (chat header, calendar, notifications).
 * Mounted by AppLayout. Also renders the incoming-call UI.
 */

export type StartCallOptions = {
  conversationId?: string
  eventId?: string
  /** a group's drop-in call (on the group chat; nobody rings) */
  groupId?: string
  type: CallKind
}

type CallsContextValue = {
  /** Starts (or joins the live) call of a conversation / event / group and opens the call page. */
  startCall: (opts: StartCallOptions) => Promise<void>
  /** Opens the call page for an existing call. */
  joinCall: (callId: string) => void
}

const CallsContext = createContext<CallsContextValue | null>(null)

/** Same as the server's ring timeout: stop ringing even if `call:ended` never arrives. */
const RING_TIMEOUT_MS = 45_000
const START_TIMEOUT_MS = 10_000

export function CallProvider({ children }: { children: ReactNode }) {
  const socket = useSocket()
  const navigate = useNavigate()
  const [incoming, setIncoming] = useState<IncomingCall[]>([])
  const starting = useRef(false)

  const currentCallId = useMatch("/call/:callId")?.params.callId ?? null

  const joinCall = (callId: string) => {
    void navigate(`/call/${callId}`)
  }

  const startCall = async (opts: StartCallOptions) => {
    if (starting.current) return
    if (!socket?.connected)
      return void toast.error("Not connected yet, try again in a moment")
    starting.current = true
    const toastId = toast.loading(
      opts.type === "VIDEO" ? "Starting video call…" : "Starting call…"
    )
    try {
      const res = await socket
        .timeout(START_TIMEOUT_MS)
        .emitWithAck("call:start", opts)
        .catch(() => ({
          ok: false as const,
          error: "The server didn't answer, try again",
        }))
      if (!res.ok) return void toast.error(res.error, { id: toastId })
      toast.dismiss(toastId)
      joinCall(res.data.callId)
    } finally {
      starting.current = false
    }
  }

  const remove = (callId: string) =>
    setIncoming((list) => list.filter((i) => i.call.id !== callId))

  useSocketEvent("call:incoming", (p) => {
    setIncoming((list) =>
      list.some((i) => i.call.id === p.call.id)
        ? list
        : [...list, { ...p, receivedAt: Date.now() }]
    )
  })
  useSocketEvent("call:ended", ({ callId }) => remove(callId))
  useSocketEvent("call:answered", ({ callId }) => remove(callId))

  // drop prompts once they're past the ring timeout
  const nextExpiry = incoming.length
    ? Math.min(...incoming.map((i) => i.receivedAt)) + RING_TIMEOUT_MS
    : null
  useEffect(() => {
    if (nextExpiry === null) return
    const timer = setTimeout(
      () =>
        setIncoming((list) =>
          list.filter((i) => i.receivedAt + RING_TIMEOUT_MS > Date.now())
        ),
      Math.max(0, nextExpiry - Date.now())
    )
    return () => clearTimeout(timer)
  }, [nextExpiry])

  // never ring for the call we're already on (e.g. it rang again after a reconnect)
  const visible = incoming.filter((i) => i.call.id !== currentCallId)
  const current = visible[0]

  const accept = (call: IncomingCall) => {
    remove(call.call.id)
    void navigate(`/call/${call.call.id}`)
  }

  const decline = (call: IncomingCall) => {
    remove(call.call.id)
    socket?.emit("call:decline", { callId: call.call.id })
  }

  return (
    <CallsContext.Provider value={{ startCall, joinCall }}>
      {children}
      {current ? (
        <IncomingCallCard
          key={current.call.id}
          incoming={current}
          more={visible.length - 1}
          onAccept={() => accept(current)}
          onDecline={() => decline(current)}
        />
      ) : null}
    </CallsContext.Provider>
  )
}

export function useCalls() {
  const value = useContext(CallsContext)
  if (!value) throw new Error("useCalls must be used inside CallProvider")
  return value
}
