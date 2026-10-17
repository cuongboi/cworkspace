import { useEffect, useState } from "react"
import { Outlet, useLocation, useMatches } from "react-router-dom"
import { CallProvider } from "@/components/call/call-provider"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { AppProvider } from "@/hooks/use-app"
import { PageScrollContext } from "@/hooks/use-page-scroll"
import { PresenceProvider } from "@/hooks/use-presence"
import { useRealtimeSync } from "@/hooks/use-realtime-sync"
import { authClient } from "@/lib/auth-client"
import { AppHeader } from "./app-header"
import { AppSidebar } from "./app-sidebar"
import { ContactsRail } from "./contacts-rail"

/** Set on a route's `handle` to configure the shell for that page. */
export type AppLayoutOptions = {
  /** show the contacts rail on the right (feed-style pages) */
  rail?: boolean
  /** full-bleed content without page padding (chat, calendar, calls) */
  bleed?: boolean
}

/**
 * Layout route for every signed-in page (inside `<RequireAuth/>`): renders the app shell around
 * the matched page.
 */
export function AppLayout() {
  const options = useMatches().reduce<AppLayoutOptions>(
    (acc, m) => ({ ...acc, ...(m.handle as AppLayoutOptions | undefined) }),
    {}
  )
  const { rail = false, bleed = false } = options
  const { data: session, isPending } = authClient.useSession()

  if (isPending || !session) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  const value = { me: session.user, isAdmin: session.user.role === "admin" }

  return (
    <AppProvider value={value}>
      <PresenceProvider>
        <CallProvider>
          <RealtimeSync />
          <SidebarProvider>
            <AppSidebar />
            {/* the shell is pinned to the viewport so only the page area scrolls */}
            <SidebarInset className="h-svh min-w-0 overflow-hidden">
              <AppHeader />
              <div className="flex min-h-0 flex-1">
                {bleed ? (
                  // full-bleed pages size themselves and manage their own scrolling
                  <main className="flex min-w-0 flex-1 flex-col">
                    <Outlet />
                  </main>
                ) : (
                  <PageScroll />
                )}
                {rail ? <ContactsRail /> : null}
              </div>
            </SidebarInset>
          </SidebarProvider>
        </CallProvider>
      </PresenceProvider>
    </AppProvider>
  )
}

function PageScroll() {
  // state, not a ref: virtualized lists in the page need to re-render once it exists
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const { pathname } = useLocation()

  // the page no longer scrolls the window, so reset our own scroll position on navigation
  useEffect(() => {
    viewport?.scrollTo({ top: 0 })
  }, [pathname, viewport])

  return (
    <ScrollArea viewportRef={setViewport} className="min-w-0 flex-1">
      <PageScrollContext value={viewport}>
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </PageScrollContext>
    </ScrollArea>
  )
}

function RealtimeSync() {
  useRealtimeSync()
  return null
}
