import { ChevronLeftIcon, ChevronRightIcon, MenuIcon } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { COMPANY_NAME } from "@/lib/company"
import { useIsNavActive, useNavItems } from "./app-sidebar"
import { GlobalSearch } from "./global-search"
import { UserMenu } from "./user-menu"

export function AppHeader() {
  const navigate = useNavigate()

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
        <GlobalSearch />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <NotificationBell />
        <UserMenu className="md:hidden" />
      </div>
    </header>
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
