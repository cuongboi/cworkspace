import { cn } from "cn"
import { format } from "date-fns"
import {
  CopyIcon,
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
import { toast } from "sonner"
import { useCalls } from "@/components/call/call-provider"
import { AttachmentList } from "@/components/common/attachment-list"
import { RichText } from "@/components/common/rich-text"
import { UserAvatar } from "@/components/common/user-avatar"
import { Bubble, BubbleContent, BubbleReactions } from "@/components/ui/bubble"
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
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message"
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
import { useOrg } from "@/hooks/use-org"
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
  onReply: (message: ChatMessage) => void
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
          <span className="size-2 animate-pulse rounded-full bg-red-500" />
        ) : null}
        <Icon className="size-4" aria-hidden="true" />
        <span className="font-medium">{callLabel(data)}</span>
        <span
          className="text-muted-foreground"
          title={format(message.createdAt, "PPpp")}
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
          {data.live ? "Join" : data.groupCall ? "Start call" : "Call back"}
        </Button>
      </div>
    </div>
  )
}

function TextMessage({
  message,
  isGroup,
  firstInGroup,
  lastInGroup,
  status,
  actions,
}: Omit<Props, "conversationId">) {
  const { me } = useOrg()
  const [active, setActive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const mine = message.senderId === me.id
  const deleted = Boolean(message.deletedAt)
  const hasText = !deleted && message.content.trim().length > 0
  const align = mine ? "end" : "start"

  // bubble corners: tighten the side that touches the neighbouring bubble of the same sender
  const corner = mine
    ? cn(!firstInGroup && "rounded-tr-md", !lastInGroup && "rounded-br-md")
    : cn(!firstInGroup && "rounded-tl-md", !lastInGroup && "rounded-bl-md")

  const reactionGroups = REACTIONS.map((r) => ({
    ...r,
    users: message.reactions.filter((x) => x.type === r.type),
  })).filter((g) => g.users.length > 0)
  const myReaction = message.reactions.find((r) => r.userId === me.id)?.type
  const reactionNames = message.reactions.map((r) =>
    r.userId === me.id ? "You" : r.user.name
  )

  const replyTo = message.replyTo
  const showActions = !message.pending && !deleted

  const reactionBadge = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
          onClick={() => myReaction && actions.onReact(message, myReaction)}
          aria-label={`Reactions: ${reactionNames.join(", ")}`}
        >
          {reactionGroups.slice(0, 3).map((g) => (
            <span key={g.type} aria-hidden="true">
              {g.emoji}
            </span>
          ))}
          {message.reactions.length > 1 ? (
            <span className="ml-0.5 text-muted-foreground">
              {message.reactions.length}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5">
          {reactionGroups.map((g) => (
            <span key={g.type}>
              {g.emoji}{" "}
              {g.users
                .map((u) => (u.userId === me.id ? "You" : u.user.name))
                .join(", ")}
            </span>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )

  return (
    <Message
      align={align}
      data-active={active || menuOpen}
      className={cn("group/message", message.pending && "opacity-60")}
      onPointerUp={(e) => {
        // touch devices have no hover: tapping a bubble reveals its actions
        if (e.pointerType !== "touch") return
        if ((e.target as HTMLElement).closest("a,button")) return
        setActive((a) => !a)
      }}
    >
      {!mine ? (
        <MessageAvatar className="size-7 min-w-7 bg-transparent">
          {lastInGroup ? (
            <UserAvatar
              user={message.sender}
              size="sm"
              className="[&_[data-slot=avatar]]:size-7"
            />
          ) : null}
        </MessageAvatar>
      ) : null}
      <MessageContent className="gap-1">
        {isGroup && !mine && firstInGroup ? (
          <MessageHeader className="px-3 font-normal">
            {message.sender.name}
          </MessageHeader>
        ) : null}

        {replyTo ? (
          <button
            type="button"
            onClick={() => actions.onJumpTo(replyTo.id)}
            className={cn(
              "mb-[-0.75rem] flex max-w-[80%] flex-col gap-0.5 rounded-xl bg-muted/60 px-3 pt-1.5 pb-4 text-left text-xs text-muted-foreground hover:bg-muted",
              mine && "self-end"
            )}
          >
            <span className="flex items-center gap-1 font-medium">
              <ReplyIcon className="size-3" aria-hidden="true" />
              {mine ? "You" : message.sender.name.split(/\s+/)[0]} replied to{" "}
              {replyTo.senderId === me.id
                ? mine
                  ? "yourself"
                  : "you"
                : replyTo.senderId === message.senderId
                  ? "themself"
                  : replyTo.sender.name}
            </span>
            <span className="line-clamp-2 break-words">
              {replyTo.deletedAt
                ? "Message deleted"
                : toPlainText(replyTo.content) || "Attachment"}
            </span>
          </button>
        ) : null}

        {!deleted && message.attachments.length > 0 ? (
          <div
            className={cn(
              "flex items-center gap-1",
              mine && "flex-row-reverse self-end"
            )}
          >
            <AttachmentList
              attachments={message.attachments}
              className="w-64 sm:w-72"
            />
            {!hasText && reactionGroups.length > 0 ? (
              <div className="self-end rounded-full bg-muted text-xs">
                {reactionBadge}
              </div>
            ) : null}
            {!hasText && showActions ? (
              <Toolbar
                message={message}
                mine={mine}
                myReaction={myReaction}
                actions={actions}
                onOpenChange={setMenuOpen}
              />
            ) : null}
          </div>
        ) : null}

        {hasText || deleted ? (
          <div
            className={cn(
              "flex w-full items-center gap-1",
              mine && "flex-row-reverse",
              reactionGroups.length > 0 && "mb-3.5"
            )}
          >
            <Bubble
              variant={deleted ? "outline" : mine ? "default" : "muted"}
              align={align}
              className="max-w-[min(80%,36rem)]"
            >
              <Tooltip delayDuration={700}>
                {/* keep the bubble's slot: Bubble styles its `bubble-content` child by data-slot */}
                <TooltipTrigger asChild data-slot="bubble-content">
                  <BubbleContent
                    className={cn(
                      "rounded-2xl",
                      corner,
                      deleted && "text-muted-foreground italic",
                      mine &&
                        !deleted &&
                        "[&_a]:text-primary-foreground [&_a]:underline"
                    )}
                  >
                    {deleted ? (
                      "Message deleted"
                    ) : (
                      <RichText text={message.content} />
                    )}
                  </BubbleContent>
                </TooltipTrigger>
                <TooltipContent side={mine ? "left" : "right"}>
                  {format(message.createdAt, "PPp")}
                  {message.editedAt
                    ? ` · edited ${format(message.editedAt, "PPp")}`
                    : ""}
                </TooltipContent>
              </Tooltip>
              {reactionGroups.length > 0 ? (
                <BubbleReactions
                  align={mine ? "start" : "end"}
                  className="text-xs"
                >
                  {reactionBadge}
                </BubbleReactions>
              ) : null}
            </Bubble>
            {showActions ? (
              <Toolbar
                message={message}
                mine={mine}
                myReaction={myReaction}
                actions={actions}
                onOpenChange={setMenuOpen}
              />
            ) : null}
          </div>
        ) : null}

        {message.editedAt && !deleted ? (
          <MessageFooter className="px-3 text-[11px] font-normal">
            Edited
          </MessageFooter>
        ) : null}
        {message.pending ? (
          <MessageFooter className="px-3 text-[11px] font-normal">
            Sending…
          </MessageFooter>
        ) : status ? (
          <MessageFooter className="px-3 text-[11px] font-normal">
            {status}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
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
  const [reactOpen, setReactOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const canEdit =
    mine && message.type === "TEXT" && message.content.trim().length > 0

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(message.content))
      toast.success("Copied")
    } catch {
      toast.error("Could not copy")
    }
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 group-data-[active=true]/message:opacity-100 focus-within:opacity-100",
        mine && "flex-row-reverse"
      )}
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
                size="icon-sm"
                className="rounded-full"
                aria-label="React"
              >
                <SmilePlusIcon />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>React</TooltipContent>
        </Tooltip>
        <PopoverContent side="top" className="w-auto rounded-full p-1">
          <div
            className="flex items-center gap-0.5"
            role="toolbar"
            aria-label="Reactions"
          >
            {REACTIONS.map((r) => (
              <button
                key={r.type}
                type="button"
                aria-label={r.label}
                aria-pressed={myReaction === r.type}
                title={r.label}
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label="Reply"
            onClick={() => actions.onReply(message)}
          >
            <ReplyIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reply</TooltipContent>
      </Tooltip>
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
            size="icon-sm"
            className="rounded-full"
            aria-label="More actions"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={mine ? "end" : "start"}>
          {message.content.trim() ? (
            <DropdownMenuItem onSelect={() => void copy()}>
              <CopyIcon /> Copy text
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => actions.onReply(message)}>
            <ReplyIcon /> Reply
          </DropdownMenuItem>
          {canEdit ? (
            <DropdownMenuItem onSelect={() => actions.onEdit(message)}>
              <PencilIcon /> Edit
            </DropdownMenuItem>
          ) : null}
          {mine ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => actions.onDelete(message)}
              >
                <Trash2Icon /> Unsend
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
