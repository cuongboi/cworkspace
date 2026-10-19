import { cn } from "cn"
import { UserAvatar } from "@/components/common/user-avatar"
import { accentFor } from "@/lib/accent"
import { useOnlineUsers } from "@/hooks/use-presence"
import { otherUsers } from "./chat-data"

type Props = {
  type: "DIRECT" | "GROUP"
  members: {
    userId: string
    user: { id: string; name: string; image: string | null }
  }[]
  meId: string
  /** a group's chat shows the group instead of its members */
  group?: { id: string; name: string; coverUrl: string | null } | null
  size?: "sm" | "default" | "lg"
  className?: string
}

/** DM: the other person with a presence dot. Group: two stacked avatars (+ dot if anyone is online). */
export function ConversationAvatar({
  type,
  members,
  meId,
  group,
  size = "default",
  className,
}: Props) {
  const online = useOnlineUsers()
  const others = otherUsers(members, meId)
  const box = size === "lg" ? "size-12" : size === "sm" ? "size-6" : "size-10"

  if (group) {
    return group.coverUrl ? (
      <img
        src={group.coverUrl}
        alt=""
        className={cn("shrink-0 rounded-lg object-cover", box, className)}
      />
    ) : (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white",
          box,
          className
        )}
        style={{ backgroundColor: accentFor(group.id) }}
      >
        {group.name[0]?.toUpperCase()}
      </span>
    )
  }

  if (type === "DIRECT" || others.length < 2) {
    const user = others[0] ?? { id: meId, name: "?", image: null }
    return <UserAvatar user={user} size={size} presence className={className} />
  }

  const [a, b] = others
  const anyOnline = others.some((u) => online.has(u.id))
  return (
    <span
      className={cn("relative inline-flex shrink-0", box, className)}
      aria-hidden="true"
    >
      {b ? (
        <UserAvatar
          user={b}
          size="sm"
          className={"absolute top-0 right-0 h-6 w-6 opacity-90"}
        />
      ) : null}
      {a ? (
        <UserAvatar
          user={a}
          size="sm"
          className="absolute bottom-0 left-0 h-6 w-6 rounded-full ring-2 ring-background"
        />
      ) : null}
      {anyOnline ? (
        <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
      ) : null}
    </span>
  )
}
