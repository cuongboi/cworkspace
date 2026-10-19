import {
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { UserAvatar } from "@/components/common/user-avatar"
import { useTheme } from "@/components/theme-provider"
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
import { useApp } from "@/hooks/use-app"
import { authClient } from "@/lib/auth-client"
import { disablePush } from "@/lib/push"
import { cn } from "@/lib/utils"

export function UserMenu({
  className,
  side,
  align = "end",
}: {
  className?: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
}) {
  const { me } = useApp()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("rounded-full", className)}
          aria-label="Account"
        >
          <UserAvatar
            user={{ id: me.id, name: me.name, image: me.image ?? null }}
            size="default"
            presence
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" side={side} align={align}>
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
            await disablePush().catch(() => { })
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
