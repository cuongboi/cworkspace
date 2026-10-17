import { createContext, type ReactNode, useContext } from "react"
import type { SessionUser } from "@/lib/auth-client"

export type AppContextValue = {
  me: SessionUser
  /** instance admin (`User.role === "admin"`) */
  isAdmin: boolean
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({
  value,
  children,
}: {
  value: AppContextValue
  children: ReactNode
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

/** The signed-in user. Only usable inside `AppLayout`. */
export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error("useApp must be used inside AppLayout")
  return value
}
