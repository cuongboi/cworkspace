import { cn } from "cn"
import {
  AtSignIcon,
  BellRingIcon,
  CalendarPlusIcon,
  CheckIcon,
  HeartIcon,
  type LucideIcon,
  MailIcon,
  MailOpenIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  NewspaperIcon,
  PhoneMissedIcon,
  ReplyIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import type { ReactNode } from "react"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"
import { TimeAgo } from "@/components/common/time-ago"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { db } from "@/lib/api-client"
import i18n, { errorMessage } from "@/lib/i18n"
import { toPlainText } from "@/lib/mentions"
import { useDbMutation } from "@/lib/query"
import {
  REACTION_EMOJI,
  dataField,
  notificationHref,
} from "@app/shared/notifications"

export { notificationHref }

/** `include` used by every notification list so the renderer gets the same shape. */
export const notificationInclude = {
  actor: { select: { id: true, name: true, image: true } },
  post: { select: { id: true, content: true } },
  group: { select: { name: true, slug: true } },
  event: { select: { id: true, title: true, startAt: true } },
} as const

export type NotificationRow = Awaited<
  ReturnType<
    typeof db.notification.findMany<{ include: typeof notificationInclude }>
  >
>[number]

/** The fields the renderer needs: a full row, or a live `notification:new` payload. */
export type NotificationLike = {
  type: string
  actor: { id: string; name: string; image: string | null } | null
  data: unknown
  postId: string | null
  commentId: string | null
  groupId: string | null
  eventId: string | null
  conversationId: string | null
  post?: { content: string } | null
  group?: { name: string; slug: string } | null
  event?: { title: string } | null
}

const TYPE_META: Record<string, { icon: LucideIcon; className: string }> = {
  MENTION: { icon: AtSignIcon, className: "bg-blue-500" },
  POST_COMMENT: { icon: MessageCircleIcon, className: "bg-success" },
  COMMENT_REPLY: { icon: ReplyIcon, className: "bg-success" },
  POST_REACTION: { icon: HeartIcon, className: "bg-rose-500" },
  GROUP_POST: { icon: NewspaperIcon, className: "bg-indigo-500" },
  GROUP_JOIN_REQUEST: { icon: UserPlusIcon, className: "bg-sky-500" },
  GROUP_JOIN_APPROVED: { icon: CheckIcon, className: "bg-sky-500" },
  EVENT_INVITE: { icon: CalendarPlusIcon, className: "bg-violet-500" },
  EVENT_REMINDER: { icon: BellRingIcon, className: "bg-warning" },
  MISSED_CALL: { icon: PhoneMissedIcon, className: "bg-destructive" },
}

/** The sentence describing a notification, with emphasized names. */
export function describeNotification(n: NotificationLike): ReactNode {
  const actor = n.actor?.name ?? i18n.t("notifications.someone")
  const group = n.group?.name ?? i18n.t("notifications.aGroup")
  const event =
    n.event?.title ??
    dataField(n.data, "title") ??
    i18n.t("notifications.anEvent")
  const reaction = dataField(n.data, "reaction")
  const emoji = (reaction && REACTION_EMOJI[reaction]) ?? "👍"
  const key = (() => {
    switch (n.type) {
      case "MENTION":
        return n.conversationId
          ? "notifications.text.mentionChat"
          : n.commentId
            ? "notifications.text.mentionComment"
            : "notifications.text.mentionPost"
      case "POST_COMMENT":
        return "notifications.text.postComment"
      case "COMMENT_REPLY":
        return "notifications.text.commentReply"
      case "POST_REACTION":
        return "notifications.text.postReaction"
      case "GROUP_POST":
        return "notifications.text.groupPost"
      case "GROUP_JOIN_REQUEST":
        return "notifications.text.joinRequest"
      case "GROUP_JOIN_APPROVED":
        return "notifications.text.joinApproved"
      case "EVENT_INVITE":
        return "notifications.text.eventInvite"
      case "EVENT_REMINDER":
        return "notifications.text.eventReminder"
      case "MISSED_CALL":
        return "notifications.text.missedCall"
      default:
        return "notifications.text.other"
    }
  })()
  return (
    <Trans
      i18nKey={key}
      values={{ actor, group, event, emoji }}
      components={{ b: <strong className="font-semibold" /> }}
    />
  )
}

/** Resolves the link of a live payload (which carries ids only). */
export async function resolveNotificationHref(n: NotificationLike) {
  if (
    !n.group &&
    n.groupId &&
    (n.type === "GROUP_JOIN_REQUEST" ||
      n.type === "GROUP_JOIN_APPROVED" ||
      !n.postId)
  ) {
    const group = await db.group
      .findUnique({ where: { id: n.groupId }, select: { slug: true } })
      .catch(() => null)
    return notificationHref(n, group?.slug)
  }
  return notificationHref(n)
}

export function NotificationIcon({
  n,
  className,
}: {
  n: NotificationLike
  className?: string
}) {
  const meta = TYPE_META[n.type] ?? {
    icon: BellRingIcon,
    className: "bg-muted-foreground",
  }
  const Icon = meta.icon
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {n.actor ? (
        <UserAvatar user={n.actor} size="lg" />
      ) : (
        <span className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </span>
      )}
      <span
        className={cn(
          "absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full text-white ring-2 ring-background",
          meta.className
        )}
        aria-hidden
      >
        <Icon className="size-3" />
      </span>
    </span>
  )
}

/** Mark read / unread / dismiss, refreshing every notification query (lists and counts). */
export function useNotificationActions() {
  const opts = { invalidates: ["notification" as const] }
  const markRead = useDbMutation(
    ({ id, read }: { id: string; read: boolean }) =>
      db.notification.update({
        where: { id },
        data: { readAt: read ? new Date() : null },
      }),
    opts
  )
  const dismiss = useDbMutation(
    (id: string) => db.notification.delete({ where: { id } }),
    opts
  )
  const onError = (err: Error) => toast.error(errorMessage(err))
  return {
    markRead: (id: string, read = true) =>
      markRead.mutate({ id, read }, { onError }),
    dismiss: (id: string) => dismiss.mutate(id, { onError }),
  }
}

type ItemProps = {
  notification: NotificationRow
  /** called after following the link (e.g. to close the bell popover) */
  onNavigate?: () => void
  className?: string
}

export function NotificationItem({
  notification: n,
  onNavigate,
  className,
}: ItemProps) {
  const { t } = useTranslation()
  const { markRead, dismiss } = useNotificationActions()
  const unread = n.readAt === null
  const snippet = n.post?.content ? toPlainText(n.post.content).trim() : ""

  return (
    <div
      className={cn(
        "group/notification relative flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/70",
        unread && "bg-primary/5 dark:bg-primary/10",
        className
      )}
    >
      <Link
        to={notificationHref(n)}
        onClick={() => {
          if (unread) markRead(n.id)
          onNavigate?.()
        }}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        <NotificationIcon n={n} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-12">
          <span
            className={cn(
              "text-sm leading-snug",
              !unread && "text-muted-foreground"
            )}
          >
            {describeNotification(n)}
          </span>
          {snippet ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">
              “{snippet}”
            </span>
          ) : null}
          <TimeAgo
            date={n.createdAt}
            className={cn(
              "text-xs",
              unread ? "font-medium text-primary" : "text-muted-foreground"
            )}
          />
        </span>
      </Link>
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
        {unread ? (
          <span
            className="size-2.5 rounded-full bg-primary"
            aria-label={t("notifications.unreadDot")}
            role="img"
          />
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative z-10 rounded-full opacity-0 group-hover/notification:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 max-md:opacity-100"
              aria-label={t("notifications.options")}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => markRead(n.id, unread)}>
              {unread ? <MailOpenIcon /> : <MailIcon />}
              {unread
                ? t("notifications.markRead")
                : t("notifications.markUnread")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => dismiss(n.id)}
            >
              <Trash2Icon />
              {t("notifications.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function NotificationSkeleton() {
  return (
    <div className="flex items-start gap-3 p-2">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
}
