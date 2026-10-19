import {
  BellIcon,
  CalendarIcon,
  HomeIcon,
  type LucideIcon,
  MessageCircleIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import { cn } from "@/lib/utils"
import { UserMenu } from "./user-menu"

/** Unread conversations: last message newer than my read marker. */
function useUnreadChats() {
  const { me } = useApp()
  const { data = [] } = useDbQuery(
    ["conversationMember", "findMany", "unread"],
    () =>
      db.conversationMember.findMany({
        where: { userId: me.id },
        select: {
          lastReadAt: true,
          conversation: { select: { lastMessageAt: true } },
        },
      })
  )
  return data.filter((m) => m.conversation.lastMessageAt > m.lastReadAt).length
}

type NavItem = {
  label: string
  icon: LucideIcon
  path: string
  badge?: number
}

export function useNavItems(): NavItem[] {
  const { isAdmin } = useApp()
  const unreadChats = useUnreadChats()
  return [
    { label: "Activity", icon: BellIcon, path: "/notifications" },
    {
      label: "Chat",
      icon: MessageCircleIcon,
      path: "/chat",
      badge: unreadChats,
    },
    { label: "Home", icon: HomeIcon, path: "/" },
    { label: "Groups", icon: UsersIcon, path: "/groups" },
    { label: "Calendar", icon: CalendarIcon, path: "/calendar" },
    { label: "People", icon: UserIcon, path: "/people" },
    ...(isAdmin
      ? [{ label: "Admin", icon: SettingsIcon, path: "/settings" }]
      : []),
  ]
}

export function useIsNavActive() {
  const { pathname } = useLocation()
  return (path: string) =>
    path === "/" ? pathname === "/" : pathname.startsWith(path)
}

/** Teams-style app bar: a narrow column of icon + label buttons. */
export function AppSidebar({ className }: { className?: string }) {
  const nav = useNavItems()
  const isActive = useIsNavActive()

  return (
    <nav
      aria-label="Main"
      className={cn(
        "flex w-17 shrink-0 flex-col items-stretch gap-1 py-2",
        className
      )}
    >
      {nav.map((item) => (
        <NavButton key={item.path} item={item} active={isActive(item.path)} />
      ))}
      <div className="mt-auto flex justify-center pt-2">
        <UserMenu side="right" align="end" />
      </div>
    </nav>
  )
}

function NavButton({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.path}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative mx-1 flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
        active && "font-semibold text-foreground"
      )}
    >
      {/* the active indicator sits on the rail's left edge like Teams */}
      {active ? (
        <span className="absolute top-2 bottom-2 -left-1 w-0.75 rounded-r bg-foreground" />
      ) : null}
      <span className="relative">
        <item.icon className={cn("size-5", active && "fill-foreground/10")} />
        {item.badge ? (
          <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </span>
      <span className="leading-tight">{item.label}</span>
    </Link>
  )
}
