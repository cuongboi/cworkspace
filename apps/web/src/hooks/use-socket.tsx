import { useQueryClient } from "@tanstack/react-query"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
} from "react"

import { authClient } from "@/lib/auth-client"
import { RealtimeClient } from "@/lib/realtime"
import type { ServerToClientEvents } from "@/lib/realtime-events"

export type AppSocket = RealtimeClient

const SocketContext = createContext<AppSocket | null>(null)

/** One shared, authenticated WebSocket for the signed-in user (the session cookie authenticates it). */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession()
  const userId = session?.user.id
  const queryClient = useQueryClient()
  const [socket, setSocket] = useState<AppSocket | null>(null)

  useEffect(() => {
    if (!userId) return
    const instance = new RealtimeClient()
    // Events may have been missed while offline: refetch everything that is mounted.
    instance.on("reconnect", () => void queryClient.invalidateQueries())
    // the socket is an external resource owned by this effect; expose it once created
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(instance)
    return () => {
      instance.close()
      setSocket(null)
    }
  }, [userId, queryClient])

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  )
}

/** The shared socket (null when signed out). Check `connected` before relying on an emit. */
export function useSocket() {
  return useContext(SocketContext)
}

/** Subscribes to a typed server event for the lifetime of the component. */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E]
) {
  const socket = useSocket()
  const onEvent = useEffectEvent(
    (payload: Parameters<ServerToClientEvents[E]>[0]) =>
      (handler as (p: typeof payload) => void)(payload)
  )

  useEffect(() => {
    if (!socket) return
    // Effect events must be called from inside effects, not passed around: wrap it.
    const listener = (payload: Parameters<ServerToClientEvents[E]>[0]) =>
      onEvent(payload)
    // a generic event key doesn't narrow the listener map: cast once here
    const s = socket as unknown as {
      on(e: string, l: typeof listener): void
      off(e: string, l: typeof listener): void
    }
    s.on(event, listener)
    return () => {
      s.off(event, listener)
    }
  }, [socket, event])
}
