import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  HashIcon,
  MessageCircleOffIcon,
  PanelRightIcon,
  PhoneIcon,
  SearchIcon,
  UploadIcon,
  VideoIcon,
} from "lucide-react"
import { cn } from "cn"
import { useQueryState } from "nuqs"
import { Link } from "react-router-dom"
import { type ReactNode, useEffect, useState } from "react"
import { toast } from "sonner"
import { useCalls } from "@/components/call/call-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useIsMobile, useIsWide } from "@/hooks/use-mobile"
import { useApp } from "@/hooks/use-app"
import { useIsOnline } from "@/hooks/use-presence"
import { useSocketEvent } from "@/hooks/use-socket"
import { useUploads } from "@/hooks/use-uploads"
import { ApiError, db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import { chatInfoParser, chatInfoTabParser } from "@/lib/search-params"
import type { CallKind } from "@/lib/realtime-events"
import type { ReactionType } from "@app/api/zenstack/models"
import {
  type ChatMessage,
  conversationKey,
  conversationTitle,
  fetchConversation,
  fetchMembers,
  fetchMessage,
  findCachedMessage,
  insertMessage,
  membersKey,
  messagesKey,
  otherUsers,
  patchMessage,
  replaceMessage,
  type ThreadConversation,
  type ThreadMember,
} from "./chat-data"
import { Composer, type ComposerMode } from "./composer"
import { ConversationAvatar } from "./conversation-avatar"
import { ConversationInfoPanel } from "./conversation-info-panel"
import { ConversationInfoSheet } from "./conversation-info-sheet"
import { MessageList } from "./message-list"
import { ThreadScrollProvider } from "./thread-scroll"

type ThreadVariant = "page" | "panel"

/**
 * One conversation. `page` is the Messenger pane; `panel` is embedded (group page, call screen):
 * a compact header without call/back buttons, with `actions` on the right, sized by its parent.
 */
export function ChatThread({
  conversationId,
  variant = "page",
  actions,
  crumbs,
}: {
  conversationId: string
  variant?: ThreadVariant
  actions?: ReactNode
  /** page variant: replaces the default "Section / title" breadcrumb */
  crumbs?: ReactNode
}) {
  useLiveMessages(conversationId)
  const conversation = useDbQuery(conversationKey(conversationId), () =>
    fetchConversation(conversationId)
  )
  const members = useDbQuery(membersKey(conversationId), () =>
    fetchMembers(conversationId)
  )

  if (conversation.isPending || members.isPending) return <ThreadLoading />
  if (!conversation.data || conversation.error || members.error) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleOffIcon />
          </EmptyMedia>
          <EmptyTitle>Conversation not available</EmptyTitle>
          <EmptyDescription>
            It may have been deleted, or you're no longer a member.
          </EmptyDescription>
        </EmptyHeader>
        {variant === "page" ? (
          <EmptyContent>
            <Button asChild variant="secondary">
              <Link to={"/chat"}>Back to chats</Link>
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    )
  }

  return (
    <ThreadScrollProvider>
      <ThreadView
        conversation={conversation.data}
        members={members.data ?? []}
        variant={variant}
        actions={actions}
        crumbs={crumbs}
      />
    </ThreadScrollProvider>
  )
}

function ThreadView({
  conversation,
  members,
  variant,
  actions,
  crumbs,
}: {
  conversation: ThreadConversation
  members: ThreadMember[]
  variant: ThreadVariant
  actions?: ReactNode
  crumbs?: ReactNode
}) {
  const { me } = useApp()
  const qc = useQueryClient()
  const uploads = useUploads()
  const [mode, setMode] = useState<ComposerMode | null>(null)
  const isWide = useIsWide()
  // wide pages show details as a column (toggle kept in the URL); otherwise as a sheet
  const [infoColumn, setInfoColumn] = useQueryState("info", chatInfoParser)
  const [infoOpen, setInfoOpen] = useState(false)
  const showColumn = variant === "page" && isWide && infoColumn
  const toggleInfo = () =>
    variant === "page" && isWide
      ? void setInfoColumn(infoColumn ? false : null)
      : setInfoOpen(true)
  const [, setInfoTab] = useQueryState("infoTab", chatInfoTabParser)
  const openSearch = () => {
    void setInfoTab("search")
    if (variant === "page" && isWide) void setInfoColumn(null)
    else setInfoOpen(true)
  }
  const [toDelete, setToDelete] = useState<ChatMessage | null>(null)
  const [dragging, setDragging] = useState(false)
  const typing = useTypingUsers(conversation.id)
  const isMember = members.some((m) => m.userId === me.id)

  const react = (message: ChatMessage, type: ReactionType) => {
    const mine = message.reactions.find((r) => r.userId === me.id)
    const removing = mine?.type === type
    const previous = message.reactions
    patchMessage(qc, conversation.id, message.id, (m) => ({
      ...m,
      reactions: removing
        ? m.reactions.filter((r) => r.userId !== me.id)
        : [
            ...m.reactions.filter((r) => r.userId !== me.id),
            {
              id: `temp-${me.id}`,
              userId: me.id,
              type,
              user: { name: me.name },
            },
          ],
    }))
    const where = {
      messageId_userId: { messageId: message.id, userId: me.id },
    }
    const request = removing
      ? db.messageReaction.delete({ where, select: { id: true } })
      : db.messageReaction.upsert({
          where,
          create: { messageId: message.id, type },
          update: { type },
          select: { id: true },
        })
    request.catch((err: unknown) => {
      patchMessage(qc, conversation.id, message.id, (m) => ({
        ...m,
        reactions: previous,
      }))
      toast.error(err instanceof ApiError ? err.message : "Could not react")
    })
  }

  const unsend = (message: ChatMessage) => {
    const previous = { content: message.content, deletedAt: message.deletedAt }
    patchMessage(qc, conversation.id, message.id, (m) => ({
      ...m,
      content: "",
      deletedAt: new Date(),
    }))
    if (mode?.message.id === message.id) setMode(null)
    db.message
      .update({
        where: { id: message.id },
        data: { deletedAt: new Date(), content: "" },
        select: { id: true },
      })
      .catch((err: unknown) => {
        patchMessage(qc, conversation.id, message.id, (m) => ({
          ...m,
          ...previous,
        }))
        toast.error(
          err instanceof ApiError ? err.message : "Could not unsend the message"
        )
      })
  }

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="Conversation"
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background"
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes("Files")) setDragging(true)
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault()
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDragging(false)
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setDragging(false)
          void uploads.add(e.dataTransfer.files)
        }}
      >
        <ThreadHeader
          conversation={conversation}
          members={members}
          variant={variant}
          actions={actions}
          crumbs={crumbs}
          infoShown={showColumn}
          onOpenInfo={toggleInfo}
          onSearch={openSearch}
        />
        <MessageList
          conversation={conversation}
          members={members}
          actions={{
            onReact: react,
            onReply: (message) => setMode({ kind: "reply", message }),
            onEdit: (message) => setMode({ kind: "edit", message }),
            onDelete: setToDelete,
          }}
        />
        <TypingIndicator names={typing} />
        <Composer
          key={conversation.id}
          conversationId={conversation.id}
          mode={mode}
          onModeChange={setMode}
          uploads={uploads}
          members={members.map((m) => m.user)}
          isGroup={conversation.type === "GROUP"}
          disabled={!isMember}
        />

        {dragging ? (
          <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/90 text-primary">
            <UploadIcon className="size-8" />
            <p className="text-sm font-medium">Drop files to attach</p>
          </div>
        ) : null}

        <ConversationInfoSheet
          key={`info-${conversation.id}-${conversation.title ?? ""}`}
          open={infoOpen && !showColumn}
          onOpenChange={setInfoOpen}
          conversation={conversation}
          members={members}
        />

        <AlertDialog
          open={toDelete !== null}
          onOpenChange={(o) => !o && setToDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unsend this message?</AlertDialogTitle>
              <AlertDialogDescription>
                It will be removed for everyone in the conversation. People will
                see that a message was deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (toDelete) unsend(toDelete)
                  setToDelete(null)
                }}
              >
                Unsend
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
      {showColumn ? (
        <aside
          aria-label="Conversation details"
          className="w-80 shrink-0 border-l"
        >
          <ConversationInfoPanel
            key={`info-${conversation.id}-${conversation.title ?? ""}`}
            conversation={conversation}
            members={members}
          />
        </aside>
      ) : null}
    </div>
  )
}

function ThreadHeader({
  conversation,
  members,
  variant,
  actions,
  crumbs,
  infoShown = false,
  onOpenInfo,
  onSearch,
}: {
  conversation: ThreadConversation
  members: ThreadMember[]
  variant: ThreadVariant
  actions?: ReactNode
  crumbs?: ReactNode
  infoShown?: boolean
  onOpenInfo: () => void
  onSearch: () => void
}) {
  const { me } = useApp()
  const isMobile = useIsMobile()
  const { startCall } = useCalls()
  const [calling, setCalling] = useState<CallKind | null>(null)
  const isGroup = conversation.type === "GROUP"
  const other = !isGroup ? otherUsers(members, me.id)[0] : undefined
  const online = useIsOnline(other?.id)
  const title = conversationTitle(conversation, members, me.id)
  const subtitle = isGroup
    ? `${members.length} members`
    : online
      ? "Active now"
      : null

  const call = async (type: CallKind) => {
    setCalling(type)
    try {
      await startCall({ conversationId: conversation.id, type })
    } finally {
      setCalling(null)
    }
  }

  if (variant === "panel") {
    return (
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <button
          type="button"
          onClick={onOpenInfo}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ConversationAvatar
            type={conversation.type}
            group={conversation.group}
            members={members}
            meId={me.id}
            size="sm"
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {title}
            </span>
            {subtitle ? (
              <span className="block truncate text-xs text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Search in conversation"
                onClick={onSearch}
              >
                <SearchIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search in conversation</TooltipContent>
          </Tooltip>
          {actions}
        </div>
      </header>
    )
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:px-5">
      {isMobile ? (
        <Button asChild variant="ghost" size="icon-sm">
          <Link to={"/chat"} aria-label="Back to chats">
            <ArrowLeftIcon />
          </Link>
        </Button>
      ) : null}
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-2 text-xs"
      >
        {crumbs ?? (
          <>
            <Link
              to={"/chat"}
              className="hidden shrink-0 text-muted-foreground hover:text-foreground sm:inline"
            >
              {isGroup ? "Groups" : "Direct messages"}
            </Link>
            <span className="hidden text-muted-foreground/60 sm:inline">/</span>
            {isGroup ? (
              <HashIcon className="size-3 shrink-0 text-muted-foreground" />
            ) : (
              <ConversationAvatar
                type={conversation.type}
                group={conversation.group}
                members={members}
                meId={me.id}
                size="sm"
                className="size-5"
              />
            )}
            <h2 className="min-w-0 truncate font-medium" aria-current="page">
              {title}
            </h2>
            {subtitle ? (
              <span className="hidden shrink-0 text-[11px] text-muted-foreground md:inline">
                · {subtitle}
              </span>
            ) : null}
          </>
        )}
      </nav>
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Search in conversation"
              onClick={onSearch}
            >
              <SearchIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search in conversation</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Start video call"
              disabled={calling !== null}
              onClick={() => void call("VIDEO")}
            >
              <VideoIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Video call</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Start audio call"
              disabled={calling !== null}
              onClick={() => void call("AUDIO")}
            >
              <PhoneIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Audio call</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Conversation details"
              aria-pressed={infoShown}
              className={cn(infoShown && "bg-accent")}
              onClick={onOpenInfo}
            >
              <PanelRightIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {infoShown ? "Hide details" : "Show details"}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

/** Who is typing in this conversation (entries expire 3s after the last signal). */
function useTypingUsers(conversationId: string) {
  const { me } = useApp()
  const [typing, setTyping] = useState<
    Record<string, { name: string; until: number }>
  >({})

  useSocketEvent("typing", ({ conversationId: id, user }) => {
    if (id !== conversationId || user.id === me.id) return
    setTyping((t) => ({
      ...t,
      [user.id]: { name: user.name, until: Date.now() + 3000 },
    }))
  })
  useSocketEvent("message:new", (m) => {
    if (m.conversationId !== conversationId) return
    setTyping((t) => {
      if (!(m.senderId in t)) return t
      const rest = { ...t }
      delete rest[m.senderId]
      return rest
    })
  })

  useEffect(() => {
    const entries = Object.values(typing)
    if (entries.length === 0) return
    const nextExpiry = Math.min(...entries.map((e) => e.until))
    const t = setTimeout(
      () => {
        const now = Date.now()
        setTyping((cur) =>
          Object.fromEntries(
            Object.entries(cur).filter(([, v]) => v.until > now)
          )
        )
      },
      Math.max(0, nextExpiry - Date.now()) + 20
    )
    return () => clearTimeout(t)
  }, [typing])

  return Object.values(typing).map((v) => v.name.split(/\s+/)[0] ?? v.name)
}

function TypingIndicator({ names }: { names: string[] }) {
  const label =
    names.length === 0
      ? ""
      : names.length === 1
        ? `${names[0]} is typing…`
        : names.length === 2
          ? `${names[0]} and ${names[1]} are typing…`
          : "Several people are typing…"
  return (
    <div
      className="h-5 shrink-0 px-4 text-xs text-muted-foreground"
      aria-live="polite"
    >
      {label ? (
        <span className="flex items-center gap-1.5">
          <span className="flex gap-0.5" aria-hidden="true">
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground" />
          </span>
          {label}
        </span>
      ) : null}
    </div>
  )
}

function ThreadLoading() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <div className="flex h-12 items-center gap-2 border-b px-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex-1" />
      <div className="px-3 pb-4 md:px-6 md:pb-6">
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    </div>
  )
}

/**
 * Appends `message:new` rows of this thread instantly (deduped by id; my own optimistic
 * message is reconciled), then fetches the full row (attachments, reply quote) in the background.
 */
function useLiveMessages(conversationId: string) {
  const qc = useQueryClient()

  useSocketEvent("message:new", (payload) => {
    if (payload.conversationId !== conversationId) return
    if (!qc.getQueryData(messagesKey(conversationId))) return
    const quoted = payload.replyToId
      ? findCachedMessage(qc, conversationId, payload.replyToId)
      : undefined
    const message: ChatMessage = {
      ...payload,
      data: (payload.data ?? null) as ChatMessage["data"],
      attachments: [],
      reactions: [],
      integration: payload.integration ?? null,
      replyTo: quoted
        ? {
            id: quoted.id,
            content: quoted.content,
            deletedAt: quoted.deletedAt,
            senderId: quoted.senderId,
            sender: { name: quoted.sender.name },
          }
        : null,
    }
    insertMessage(qc, message)
    fetchMessage(payload.id)
      .then((full) => {
        if (full) replaceMessage(qc, conversationId, full.id, full)
      })
      .catch(() => undefined)
  })
}
