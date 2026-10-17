import { cn } from "cn"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useIsOnline } from "@/hooks/use-presence"
import { accentFor } from "@/lib/accent"

export function initials(name: string | null | undefined) {
  const parts = (name ?? "?").trim().split(/\s+/).filter(Boolean)
  return (
    (parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase()
}

type Props = {
  user: { id?: string; name: string | null; image?: string | null }
  size?: "sm" | "default" | "lg" | "xl"
  /** show the green presence dot when the user is online */
  presence?: boolean
  className?: string
}

export function UserAvatar({
  user,
  size = "default",
  presence = false,
  className,
}: Props) {
  const online = useIsOnline(presence ? user.id : null)
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar
        size={size === "xl" ? "lg" : size}
        className={cn(size === "xl" && "size-20")}
      >
        {user.image ? <AvatarImage src={user.image} alt="" /> : null}
        <AvatarFallback
          className={cn(
            "font-semibold text-white",
            size === "xl" && "text-2xl"
          )}
          style={{ backgroundColor: accentFor(user.id ?? user.name) }}
        >
          {initials(user.name)}
        </AvatarFallback>
      </Avatar>
      {online ? (
        <span
          role="img"
          aria-label="Online"
          className="absolute right-0 bottom-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background"
        />
      ) : null}
    </span>
  )
}
