import { createContext, type ReactNode, useContext } from "react"
import type { SessionUser } from "@/lib/auth-client"

export type OrgRole = "owner" | "admin" | "member"

export type OrgContextValue = {
  org: { id: string; name: string; slug: string; logo?: string | null }
  me: SessionUser
  role: OrgRole
  /** owner or admin */
  isAdmin: boolean
  /** Builds a tenant-scoped URL: `href("/groups")` → `/acme/groups`. */
  href: (path?: string) => string
}

const OrgContext = createContext<OrgContextValue | null>(null)

export function OrgProvider({
  value,
  children,
}: {
  value: OrgContextValue
  children: ReactNode
}) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

/** The current tenant. Only usable inside `OrgLayout` (pages under `/[orgSlug]`). */
export function useOrg() {
  const value = useContext(OrgContext)
  if (!value) throw new Error("useOrg must be used inside OrgLayout")
  return value
}
