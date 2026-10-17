import {
  CalendarIcon,
  ChevronsUpDownIcon,
  HomeIcon,
  LogOutIcon,
  MessageCircleIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate, useLocation } from "react-router-dom"
import { useTheme } from "@/components/theme-provider"
import { UserAvatar } from "@/components/common/user-avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useOrg } from "@/hooks/use-org"
import { accentFor } from "@/lib/accent"
import { db } from "@/lib/api-client"
import { authClient } from "@/lib/auth-client"
import { useDbQuery } from "@/lib/query"

/** Unread conversations: last message newer than my read marker. */
function useUnreadChats() {
  const { org, me } = useOrg()
  const { data = [] } = useDbQuery(
    ["conversationMember", "findMany", "unread", org.id],
    () =>
      db.conversationMember.findMany({
        where: { userId: me.id, conversation: { organizationId: org.id } },
        select: {
          lastReadAt: true,
          conversation: { select: { lastMessageAt: true } },
        },
      })
  )
  return data.filter((m) => m.conversation.lastMessageAt > m.lastReadAt).length
}

export function AppSidebar() {
  const { pathname } = useLocation()
  const { org, me, href, isAdmin } = useOrg()
  const unreadChats = useUnreadChats()

  const { data: groups = [] } = useDbQuery(
    ["groupMember", "findMany", "sidebar", org.id],
    () =>
      db.groupMember.findMany({
        where: {
          userId: me.id,
          status: "ACTIVE",
          group: { organizationId: org.id },
        },
        select: {
          group: {
            select: { id: true, name: true, slug: true, isDefault: true },
          },
        },
        orderBy: { createdAt: "asc" },
        take: 12,
      })
  )

  const nav = [
    { label: "Home", icon: HomeIcon, path: "/" },
    { label: "Groups", icon: UsersIcon, path: "/groups" },
    {
      label: "Chat",
      icon: MessageCircleIcon,
      path: "/chat",
      badge: unreadChats,
    },
    { label: "Calendar", icon: CalendarIcon, path: "/calendar" },
    { label: "People", icon: UserIcon, path: "/people" },
  ]
  const isActive = (path: string) => {
    const full = href(path)
    return path === "/" ? pathname === full : pathname.startsWith(full)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.path)}
                    tooltip={item.label}
                  >
                    <Link to={href(item.path)}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.badge ? (
                    <SidebarMenuBadge>
                      {item.badge > 99 ? "99+" : item.badge}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Your groups</SidebarGroupLabel>
          <SidebarGroupAction asChild title="Create group">
            <Link to={href("/groups?create=1")}>
              <PlusIcon />
              <span className="sr-only">Create group</span>
            </Link>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {groups.map(({ group }) => (
                <SidebarMenuItem key={group.id}>
                  <SidebarMenuButton
                    asChild
                    size="sm"
                    isActive={isActive(`/groups/${group.slug}`)}
                  >
                    <Link to={href(`/groups/${group.slug}`)}>
                      <span
                        className="flex size-5 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                        style={{ backgroundColor: accentFor(group.id) }}
                      >
                        {group.name[0]?.toUpperCase()}
                      </span>
                      <span>{group.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isAdmin ? (
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive("/settings")}
                    tooltip="Admin settings"
                  >
                    <Link to={href("/settings")}>
                      <SettingsIcon />
                      <span>Admin settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu
          name={me.name}
          email={me.email}
          image={me.image ?? null}
          id={me.id}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function OrgSwitcher() {
  const navigate = useNavigate()
  const { org } = useOrg()
  const { data: orgs } = authClient.useListOrganizations()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
                {org.name[0]?.toUpperCase()}
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{org.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  Workplace
                </span>
              </span>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Organizations
            </DropdownMenuLabel>
            {(orgs ?? []).map((o) => (
              <DropdownMenuItem
                key={o.id}
                onSelect={() => navigate(`/${o.slug}`)}
              >
                <span className="flex size-6 items-center justify-center rounded-md border text-xs font-semibold">
                  {o.name[0]?.toUpperCase()}
                </span>
                {o.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/onboarding")}>
              <PlusIcon />
              Create organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function UserMenu({
  id,
  name,
  email,
  image,
}: {
  id: string
  name: string
  email: string
  image: string | null
}) {
  const navigate = useNavigate()
  const { href } = useOrg()
  const { theme, setTheme } = useTheme()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <UserAvatar user={{ id, name, image }} size="sm" />
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {email}
                </span>
              </span>
              <ChevronsUpDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" side="top" align="start">
            <DropdownMenuItem onSelect={() => navigate(href(`/people/${id}`))}>
              <UserIcon />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SunIcon />
                Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                  <DropdownMenuRadioItem value="light">
                    <SunIcon /> Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <MoonIcon /> Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <MonitorIcon /> System
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await authClient.signOut()
                window.location.href = "/sign-in"
              }}
            >
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
