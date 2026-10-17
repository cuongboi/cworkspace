import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  InfoIcon,
  MessageCircleOffIcon,
  PhoneIcon,
  UploadIcon,
  VideoIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useEffect, useState } from "react"
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
import { MessageScrollerProvider } from "@/components/ui/message-scroller"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"
import { useOrg } from "@/hooks/use-org"
import { useIsOnline } from "@/hooks/use-presence"
import { useSocketEvent } from "@/hooks/use-socket"
import { useUploads } from "@/hooks/use-uploads"
import { ApiError, db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import type { CallKind } from "@/lib/realtime-events"
import type { ReactionType } from "@app/api/zenstack/models"
import {
  type ChatMessage,
  conversationKey,
  conversationTitle,
  fetchConversation,
  fetchMembers,
  membersKey,
  otherUsers,
  patchMessage,
  type ThreadConversation,
  type ThreadMember,
} from "./chat-data"
import { Composer, type ComposerMode } from "./composer"
import { ConversationAvatar } from "./conversation-avatar"
import { ConversationInfoSheet } from "./conversation-info-sheet"
import { MessageList } from "./message-list"

export function ChatThread({ conversationId }: { conversationId: string }) {
  const { href } = useOrg()
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
        <EmptyContent>
          <Button asChild variant="secondary">
            <Link to={href("/chat")}>Back to chats</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <ThreadView
        conversation={conversation.data}
        members={members.data ?? []}
      />
    </MessageScrollerProvider>
  )
}

function ThreadView({
  conversation,
  members,
}: {
  conversation: ThreadConversation
  members: ThreadMember[]
}) {
  const { org, me } = useOrg()
  const qc = useQueryClient()
  const uploads = useUploads(org.id)
  const [mode, setMode] = useState<ComposerMode | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
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
    <section
      aria-label="Conversation"
      className="relative flex h-full min-h-0 flex-col bg-background"
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
        onOpenInfo={() => setInfoOpen(true)}
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
        open={infoOpen}
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
  )
}

function ThreadHeader({
  conversation,
  members,
  onOpenInfo,
}: {
  conversation: ThreadConversation
  members: ThreadMember[]
  onOpenInfo: () => void
}) {
  const { me, href } = useOrg()
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

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-2 md:px-4">
      {isMobile ? (
        <Button asChild variant="ghost" size="icon" className="rounded-full">
          <Link to={href("/chat")} aria-label="Back to chats">
            <ArrowLeftIcon />
          </Link>
        </Button>
      ) : null}
      <button
        type="button"
        onClick={onOpenInfo}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ConversationAvatar
          type={conversation.type}
          members={members}
          meId={me.id}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{title}</span>
          {subtitle ? (
            <span className="block truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </span>
      </button>
      <div className="flex shrink-0 items-center text-primary">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-primary"
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
              size="icon"
              className="rounded-full text-primary"
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
              size="icon"
              className="rounded-full text-primary"
              aria-label="Conversation info"
              onClick={onOpenInfo}
            >
              <InfoIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Conversation info</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

/** Who is typing in this conversation (entries expire 3s after the last signal). */
function useTypingUsers(conversationId: string) {
  const { me } = useOrg()
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
      <div className="flex h-16 items-center gap-3 border-b px-4">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex-1" />
      <div className="border-t p-3">
        <Skeleton className="h-9 w-full rounded-2xl" />
      </div>
    </div>
  )
}
