import { cn } from "cn"
import { format, formatDistanceToNow } from "date-fns"
import {
  BotIcon,
  CopyIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  PhoneMissedIcon,
  ReplyIcon,
  SmilePlusIcon,
  Trash2Icon,
  VideoIcon,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useCalls } from "@/components/call/call-provider"
import { AttachmentList } from "@/components/common/attachment-list"
import { RichText } from "@/components/common/rich-text"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Marker, MarkerContent } from "@/components/ui/marker"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useApp } from "@/hooks/use-app"
import { useDateLocale } from "@/lib/i18n"
import { toPlainText } from "@/lib/mentions"
import type { ReactionType } from "@app/api/zenstack/models"
import {
  type ChatMessage,
  callLabel,
  parseCallData,
  REACTIONS,
  reactionEmoji,
} from "./chat-data"

export type MessageActions = {
  onReact: (message: ChatMessage, type: ReactionType) => void
  /** quote-reply; omitted inside a thread panel */
  onReply?: (message: ChatMessage) => void
  /** CHANNEL conversations: open the message's thread (the root, for a reply) */
  onOpenThread?: (rootId: string) => void
  onEdit: (message: ChatMessage) => void
  onDelete: (message: ChatMessage) => void
  onJumpTo: (messageId: string) => void
}

type Props = {
  message: ChatMessage
  conversationId: string
  isGroup: boolean
  firstInGroup: boolean
  lastInGroup: boolean
  /** read-receipt / delivery line under my latest message */
  status?: string | null
  actions: MessageActions
}

export function MessageRow({
  message,
  conversationId,
  isGroup,
  firstInGroup,
  lastInGroup,
  status,
  actions,
}: Props) {
  if (message.type === "SYSTEM") {
    return (
      <Marker className="justify-center py-1 text-xs">
        <MarkerContent className="text-center">
          {toPlainText(message.content)}
        </MarkerContent>
      </Marker>
    )
  }
  if (message.type === "CALL")
    return <CallMessage message={message} conversationId={conversationId} />
  return (
    <TextMessage
      message={message}
      isGroup={isGroup}
      firstInGroup={firstInGroup}
      lastInGroup={lastInGroup}
      status={status}
      actions={actions}
    />
  )
}

function CallMessage({
  message,
  conversationId,
}: {
  message: ChatMessage
  conversationId: string
}) {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const { startCall, joinCall } = useCalls()
  const data = parseCallData(message.data)
  const missed = !data.answered && !data.groupCall
  const Icon = missed
    ? PhoneMissedIcon
    : data.callType === "VIDEO"
      ? VideoIcon
      : PhoneIcon
  return (
    <div className="flex justify-center py-1">
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full bg-muted py-1 pr-1 pl-3 text-xs",
          missed && "text-destructive"
        )}
      >
        {data.live ? (
          <span className="size-2 animate-pulse rounded-full bg-destructive" />
        ) : null}
        <Icon className="size-4" aria-hidden="true" />
        <span className="font-medium">{callLabel(data)}</span>
        <span
          className="text-muted-foreground"
          title={format(message.createdAt, "PPpp", { locale })}
        >
          {format(message.createdAt, "HH:mm")}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="rounded-full text-foreground"
          onClick={() =>
            data.live && data.callId
              ? joinCall(data.callId)
              : void startCall({ conversationId, type: data.callType })
          }
        >
          {data.live
            ? t("chat.callMsg.join")
            : data.groupCall
              ? t("chat.callMsg.startCall")
              : t("chat.callMsg.callBack")}
        </Button>
      </div>
    </div>
  )
}

function TextMessage({
  message,
  firstInGroup,
  status,
  actions,
}: Omit<Props, "conversationId">) {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const { me } = useApp()
  const [active, setActive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const bot = message.integration
  // a bot's messages are stored with its creator as sender, but they aren't theirs to edit
  const mine = message.senderId === me.id && !bot
  const deleted = Boolean(message.deletedAt)
  const hasText = !deleted && message.content.trim().length > 0

  const reactionGroups = REACTIONS.map((r) => ({
    ...r,
    label: t(`chat.reactions.${r.type}`),
    users: message.reactions.filter((x) => x.type === r.type),
  })).filter((g) => g.users.length > 0)
  const myReaction = message.reactions.find((r) => r.userId === me.id)?.type

  const replyTo = message.replyTo
  const showActions = !message.pending && !deleted
  const meta = [
    message.editedAt && !deleted ? t("chat.messages.edited") : null,
    message.pending ? t("chat.messages.sending") : status,
  ].filter(Boolean)

  return (
    <div
      data-active={active || menuOpen}
      className={cn(
        "group/message relative flex gap-3.5 rounded-md px-2 py-0.5 hover:bg-muted/50 data-[active=true]:bg-muted/50",
        message.pending && "opacity-60"
      )}
      onPointerUp={(e) => {
        // touch devices have no hover: tapping a message reveals its actions
        if (e.pointerType !== "touch") return
        if ((e.target as HTMLElement).closest("a,button")) return
        setActive((a) => !a)
      }}
    >
      {/* Flat, left-aligned rows: avatar and "Name  time" head each sender's run */}
      <div className="w-8 shrink-0">
        {firstInGroup ? (
          bot ? (
            <BotAvatar name={bot.name} avatarUrl={bot.avatarUrl} />
          ) : (
            <UserAvatar
              user={message.sender}
              size="sm"
              presence
              className="mt-0.5 [&_[data-slot=avatar]]:size-8"
            />
          )
        ) : (
          <span
            className="block pt-1 text-right text-2xs leading-4 text-muted-foreground opacity-0 group-hover/message:opacity-100"
            aria-hidden="true"
          >
            {format(message.createdAt, "HH:mm")}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {firstInGroup ? (
          <div className="-mb-1 flex items-baseline gap-2">
            <span className="text-xs font-semibold">
              {bot ? bot.name : mine ? t("common.you") : message.sender.name}
            </span>
            {bot ? (
              <span className="rounded-sm bg-accent px-1 py-px text-2xs font-medium tracking-wide text-muted-foreground">
                {t("chat.messages.app")}
              </span>
            ) : null}
            <time
              dateTime={message.createdAt.toISOString()}
              title={format(message.createdAt, "PPpp", { locale })}
              className="text-2xs text-muted-foreground"
            >
              {format(message.createdAt, "p", { locale })}
            </time>
          </div>
        ) : null}

        {replyTo ? (
          <button
            type="button"
            onClick={() => actions.onJumpTo(replyTo.id)}
            className="flex max-w-xl flex-col border-l-2 pl-2 text-left text-2xs leading-normal hover:border-foreground/40"
          >
            <span className="font-semibold">
              {replyTo.senderId === me.id
                ? t("common.you")
                : replyTo.sender.name}
            </span>
            <span className="line-clamp-1 break-words text-muted-foreground">
              {replyTo.deletedAt
                ? t("chat.messages.deleted")
                : toPlainText(replyTo.content) || t("chat.composer.attachment")}
            </span>
          </button>
        ) : null}

        {hasText || deleted ? (
          <div
            className={cn(
              "max-w-3xl text-xs leading-relaxed break-words text-foreground/80",
              deleted && "text-muted-foreground italic"
            )}
          >
            {deleted ? (
              t("chat.messages.deleted")
            ) : (
              <RichText text={message.content} />
            )}
          </div>
        ) : null}

        {!deleted && message.attachments.length > 0 ? (
          <AttachmentList
            attachments={message.attachments}
            className="w-full max-w-md"
          />
        ) : null}

        {reactionGroups.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {reactionGroups.map((g) => {
              const mineHere = g.users.some((u) => u.userId === me.id)
              const names = g.users
                .map((u) =>
                  u.userId === me.id ? t("common.you") : u.user.name
                )
                .join(", ")
              return (
                <Tooltip key={g.type}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-pressed={mineHere}
                      aria-label={`${g.label}: ${names}`}
                      onClick={() => actions.onReact(message, g.type)}
                      className={cn(
                        "flex h-6 items-center gap-1 rounded-md border bg-muted/60 px-1.5 text-xs transition-colors hover:bg-accent",
                        mineHere && "border-brand/30 bg-brand-subtle text-brand"
                      )}
                    >
                      <span aria-hidden="true">{g.emoji}</span>
                      <span className="text-2xs text-muted-foreground tabular-nums">
                        {g.users.length}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{names}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ) : null}

        {actions.onOpenThread && message.threadId ? (
          <button
            type="button"
            onClick={() => actions.onOpenThread?.(message.threadId as string)}
            className="-mt-1 self-start text-2xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {t("chat.threads.repliedToThread")}
          </button>
        ) : null}

        {actions.onOpenThread && !message.threadId && message.replyCount > 0 ? (
          <ThreadSummary
            message={message}
            onOpen={() => actions.onOpenThread?.(message.id)}
          />
        ) : null}

        {meta.length ? (
          <p className="-mt-1 text-2xs text-muted-foreground">
            {meta.join(" · ")}
          </p>
        ) : null}
      </div>

      {showActions ? (
        <div className="absolute -top-3 right-2 rounded-md border bg-background opacity-0 transition-opacity group-hover/message:opacity-100 group-data-[active=true]/message:opacity-100 focus-within:opacity-100">
          <Toolbar
            message={message}
            mine={mine}
            myReaction={myReaction}
            actions={actions}
            onOpenChange={setMenuOpen}
          />
        </div>
      ) : null}
    </div>
  )
}

function ThreadSummary({
  message,
  onOpen,
}: {
  message: ChatMessage
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const repliers = [
    ...new Map(
      message.threadReplies.map((r) => [r.sender.id, r.sender])
    ).values(),
  ].slice(0, 3)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/thread -mt-1 flex max-w-md items-center gap-2 self-start rounded-md border border-transparent px-1 py-0.5 text-2xs hover:border-border hover:bg-background"
    >
      <span className="flex -space-x-1.5">
        {repliers.map((u) => (
          <UserAvatar
            key={u.id}
            user={u}
            size="sm"
            className="ring-2 ring-background [&_[data-slot=avatar]]:size-5"
          />
        ))}
      </span>
      <span className="font-semibold text-brand group-hover/thread:underline">
        {t("chat.threads.replyCount", { count: message.replyCount })}
      </span>
      {message.lastReplyAt ? (
        <span className="text-muted-foreground">
          {t("chat.threads.lastReply", {
            time: formatDistanceToNow(message.lastReplyAt, {
              addSuffix: true,
              locale,
            }),
          })}
        </span>
      ) : null}
    </button>
  )
}

function BotAvatar({
  name,
  avatarUrl,
}: {
  name: string
  avatarUrl: string | null
}) {
  return avatarUrl ? (
    <img
      src={avatarUrl}
      alt=""
      className="mt-0.5 size-8 rounded-md border object-cover"
    />
  ) : (
    <span
      aria-hidden="true"
      title={name}
      className="mt-0.5 flex size-8 items-center justify-center rounded-md border bg-muted text-muted-foreground"
    >
      <BotIcon className="size-4" />
    </span>
  )
}

function Toolbar({
  message,
  mine,
  myReaction,
  actions,
  onOpenChange,
}: {
  message: ChatMessage
  mine: boolean
  myReaction: ReactionType | undefined
  actions: MessageActions
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [reactOpen, setReactOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const canEdit =
    mine && message.type === "TEXT" && message.content.trim().length > 0

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(message.content))
      toast.success(t("chat.messages.copied"))
    } catch {
      toast.error(t("chat.messages.copyFailed"))
    }
  }

  return (
    <div
      className={cn("flex shrink-0 items-center p-0.5 text-muted-foreground")}
    >
      <Popover
        open={reactOpen}
        onOpenChange={(o) => {
          setReactOpen(o)
          onOpenChange(o || moreOpen)
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("chat.messages.react")}
              >
                <SmilePlusIcon />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("chat.messages.react")}</TooltipContent>
        </Tooltip>
        <PopoverContent side="top" className="w-auto rounded-full p-1">
          <div
            className="flex items-center gap-0.5"
            role="toolbar"
            aria-label={t("chat.messages.reactions")}
          >
            {REACTIONS.map((r) => (
              <button
                key={r.type}
                type="button"
                aria-label={t(`chat.reactions.${r.type}`)}
                aria-pressed={myReaction === r.type}
                title={t(`chat.reactions.${r.type}`)}
                onClick={() => {
                  actions.onReact(message, r.type)
                  setReactOpen(false)
                  onOpenChange(false)
                }}
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-xl transition-transform outline-none hover:scale-125 hover:bg-accent focus-visible:bg-accent",
                  myReaction === r.type && "bg-accent"
                )}
              >
                {reactionEmoji(r.type)}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {actions.onOpenThread && !message.threadId ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("chat.threads.replyInThread")}
              onClick={() => actions.onOpenThread?.(message.id)}
            >
              <MessagesSquareIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("chat.threads.replyInThread")}</TooltipContent>
        </Tooltip>
      ) : null}
      {actions.onReply ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("chat.messages.reply")}
              onClick={() => actions.onReply?.(message)}
            >
              <ReplyIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("chat.messages.reply")}</TooltipContent>
        </Tooltip>
      ) : null}
      <DropdownMenu
        open={moreOpen}
        onOpenChange={(o) => {
          setMoreOpen(o)
          onOpenChange(o || reactOpen)
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("chat.messages.moreActions")}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {message.content.trim() ? (
            <DropdownMenuItem onSelect={() => void copy()}>
              <CopyIcon /> {t("chat.messages.copyText")}
            </DropdownMenuItem>
          ) : null}
          {actions.onReply ? (
            <DropdownMenuItem onSelect={() => actions.onReply?.(message)}>
              <ReplyIcon /> {t("chat.messages.reply")}
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem onSelect={() => actions.onEdit(message)}>
              <PencilIcon /> {t("common.edit")}
            </DropdownMenuItem>
          ) : null}
          {mine ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => actions.onDelete(message)}
              >
                <Trash2Icon /> {t("chat.messages.unsend")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
