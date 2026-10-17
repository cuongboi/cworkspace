import { createContext, type ReactNode, useContext, useState } from "react"
import { useSocketEvent } from "./use-socket"

const PresenceContext = createContext<ReadonlySet<string>>(new Set())

/** Tracks who is online from the server's presence events. Mounted by OrgLayout. */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set())

  useSocketEvent("presence:snapshot", ({ online }) =>
    setOnline(new Set(online))
  )
  useSocketEvent("presence", ({ userId, online }) =>
    setOnline((prev) => {
      if (prev.has(userId) === online) return prev
      const next = new Set(prev)
      if (online) next.add(userId)
      else next.delete(userId)
      return next
    })
  )

  return (
    <PresenceContext.Provider value={online}>
      {children}
    </PresenceContext.Provider>
  )
}

export function useOnlineUsers() {
  return useContext(PresenceContext)
}

export function useIsOnline(userId: string | null | undefined) {
  const online = useContext(PresenceContext)
  return Boolean(userId && online.has(userId))
}
