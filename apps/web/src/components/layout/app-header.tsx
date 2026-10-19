import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LogOutIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  UserIcon,
} from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useEffect, useRef, useState } from "react"
import { UserAvatar } from "@/components/common/user-avatar"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import { useApp } from "@/hooks/use-app"
import { authClient } from "@/lib/auth-client"
import { disablePush } from "@/lib/push"
import { COMPANY_NAME } from "@/lib/company"
import { useIsNavActive, useNavItems } from "./app-sidebar"

export function AppHeader() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const q = searchParams.get("q") ?? ""

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-2 md:px-3">
      <MobileNav />
      <Link
        to="/"
        className="hidden w-14 shrink-0 items-center justify-center md:flex"
        title={COMPANY_NAME}
      >
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          {COMPANY_NAME[0]?.toUpperCase()}
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
        <div className="hidden items-center md:flex">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            onClick={() => navigate(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Forward"
            onClick={() => navigate(1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        {/* re-mount when ?q= changes so the box follows the URL */}
        <SearchForm key={q} initial={q} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}

function SearchForm({ initial }: { initial: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <form
      className="relative w-full max-w-xl"
      onSubmit={(e) => {
        e.preventDefault()
        if (q.trim()) void navigate(`/search?q=${encodeURIComponent(q.trim())}`)
      }}
    >
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search (Ctrl+E)"
        className="h-8 bg-card pl-8 shadow-none"
        aria-label="Search"
      />
    </form>
  )
}

/** On phones the app bar doesn't fit, so its items move into a menu. */
function MobileNav() {
  const nav = useNavItems()
  const isActive = useIsNavActive()
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Menu"
        >
          <MenuIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {nav.map((item) => (
          <DropdownMenuItem
            key={item.path}
            onSelect={() => navigate(item.path)}
            className={isActive(item.path) ? "font-semibold" : undefined}
          >
            <item.icon />
            {item.label}
            {item.badge ? (
              <span className="ml-auto text-xs text-muted-foreground">
                {item.badge}
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const { me } = useApp()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full" aria-label="Account">
          <UserAvatar
            user={{ id: me.id, name: me.name, image: me.image ?? null }}
            size="sm"
            presence
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" align="end">
        <DropdownMenuLabel className="grid leading-tight">
          <span className="truncate font-medium">{me.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {me.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(`/people/${me.id}`)}>
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
            await disablePush().catch(() => {})
            await authClient.signOut()
            window.location.href = "/sign-in"
          }}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
