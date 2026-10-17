import { useEffect } from "react"
import { Link, Outlet, useMatches, useParams } from "react-router-dom"
import { CallProvider } from "@/components/call/call-provider"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { OrgProvider, type OrgRole } from "@/hooks/use-org"
import { PresenceProvider } from "@/hooks/use-presence"
import { useRealtimeSync } from "@/hooks/use-realtime-sync"
import { db } from "@/lib/api-client"
import { authClient } from "@/lib/auth-client"
import { useDbQuery } from "@/lib/query"
import { AppHeader } from "./app-header"
import { AppSidebar } from "./app-sidebar"
import { ContactsRail } from "./contacts-rail"

/** Set on a route's `handle` to configure the shell for that page. */
export type OrgLayoutOptions = {
  /** show the contacts rail on the right (feed-style pages) */
  rail?: boolean
  /** full-bleed content without page padding (chat, calendar, calls) */
  bleed?: boolean
}

/**
 * Layout route for every page under `/:orgSlug` (inside `<RequireAuth/>`): resolves the tenant
 * from the URL, makes it the session's active organization, 404s for non-members, and renders the
 * app shell around the matched page.
 */
export function OrgLayout() {
  const { orgSlug: slug } = useParams()
  const options = useMatches().reduce<OrgLayoutOptions>(
    (acc, m) => ({ ...acc, ...(m.handle as OrgLayoutOptions | undefined) }),
    {}
  )
  const { rail = false, bleed = false } = options
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { data: orgs, isPending: orgsPending } =
    authClient.useListOrganizations()
  const org = orgs?.find((o) => o.slug === slug)

  const { data: member } = useDbQuery(
    ["member", "findFirst", "me", org?.id],
    () =>
      db.member.findFirst({
        where: {
          organizationId: org?.id ?? "",
          userId: session?.user.id ?? "",
        },
        select: { role: true },
      }),
    { enabled: Boolean(org && session) }
  )

  // keep better-auth's active organization in sync with the URL (invites, org admin APIs use it)
  const activeId = session?.session.activeOrganizationId
  useEffect(() => {
    if (org && activeId !== org.id)
      void authClient.organization.setActive({ organizationId: org.id })
  }, [org, activeId])

  if (sessionPending || orgsPending || !session) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  if (!org) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Organization not found</EmptyTitle>
            <EmptyDescription>
              It doesn't exist, or you're not a member of it.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/">Go to my organizations</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const role = (member?.role ?? "member") as OrgRole
  const value = {
    org,
    me: session.user,
    role,
    isAdmin: role === "owner" || role === "admin",
    href: (path = "") => `/${org.slug}${path === "/" ? "" : path}`,
  }

  return (
    <OrgProvider value={value}>
      <PresenceProvider>
        <CallProvider>
          <RealtimeSync />
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <AppHeader />
              <div className="flex min-h-0 flex-1">
                <main
                  className={
                    bleed
                      ? "flex min-w-0 flex-1 flex-col"
                      : "min-w-0 flex-1 p-4 md:p-6"
                  }
                >
                  <Outlet />
                </main>
                {rail ? <ContactsRail /> : null}
              </div>
            </SidebarInset>
          </SidebarProvider>
        </CallProvider>
      </PresenceProvider>
    </OrgProvider>
  )
}

function RealtimeSync() {
  useRealtimeSync()
  return null
}
