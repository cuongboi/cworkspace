import { useQueryClient } from "@tanstack/react-query"
import { MessagesSquareIcon } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Spinner } from "@/components/ui/spinner"
import { useIsMobile } from "@/hooks/use-mobile"
import { useOrg } from "@/hooks/use-org"
import { useSocketEvent } from "@/hooks/use-socket"
import { ApiError, api } from "@/lib/api-client"
import {
  type ChatMessage,
  fetchMessage,
  findCachedMessage,
  insertMessage,
  messagesKey,
  replaceMessage,
} from "./chat-data"
import { ChatThread } from "./chat-thread"
import { ConversationList } from "./conversation-list"
import { NewConversationDialog } from "./new-conversation-dialog"

/**
 * Two-pane Messenger layout: conversation list | thread. On mobile only one pane is shown:
 * the list at /chat, the thread at /chat/[id].
 */
export function ChatShell({ conversationId }: { conversationId?: string }) {
  const isMobile = useIsMobile()
  const opening = useOpenDirectFromQuery()
  useLiveMessages()

  const thread = opening ? (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-6" />
    </div>
  ) : conversationId ? (
    <ChatThread key={conversationId} conversationId={conversationId} />
  ) : (
    <NoConversationSelected />
  )

  return (
    <div className="h-[calc(100svh-3.5rem)] min-h-0 overflow-hidden">
      {isMobile ? (
        conversationId || opening ? (
          thread
        ) : (
          <ConversationList />
        )
      ) : (
        <ResizablePanelGroup orientation="horizontal" id="chat-panes">
          <ResizablePanel
            id="chat-list"
            defaultSize="320px"
            minSize={260}
            maxSize="50"
          >
            <ConversationList activeId={conversationId} />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id="chat-thread" minSize={360}>
            {thread}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}

function NoConversationSelected() {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessagesSquareIcon />
        </EmptyMedia>
        <EmptyTitle>Choose a conversation</EmptyTitle>
        <EmptyDescription>
          Pick a chat from the list, or start a new one.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <NewConversationDialog>
          <Button>New message</Button>
        </NewConversationDialog>
      </EmptyContent>
    </Empty>
  )
}

/** `/chat?with=<userId>`: find-or-create the DM with that person, then open it. */
function useOpenDirectFromQuery() {
  const navigate = useNavigate()
  const { org, href } = useOrg()
  const [searchParams] = useSearchParams()
  const withUser = searchParams.get("with") ?? undefined
  const startedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!withUser || startedRef.current === withUser) return
    startedRef.current = withUser
    api
      .post<{ id: string }>("/api/conversations/direct", {
        organizationId: org.id,
        userId: withUser,
      })
      .then(({ id }) => navigate(href(`/chat/${id}`), { replace: true }))
      .catch((err: unknown) => {
        toast.error(
          err instanceof ApiError
            ? err.message
            : "Could not open the conversation"
        )
        void navigate(href("/chat"), { replace: true })
      })
      .finally(() => {
        startedRef.current = null
      })
  }, [withUser, org.id, href, navigate])

  return Boolean(withUser)
}

/**
 * Appends `message:new` rows to any loaded thread instantly (deduped by id; my own optimistic
 * message is reconciled), then fetches the full row (attachments, reply quote) in the background.
 */
function useLiveMessages() {
  const qc = useQueryClient()

  useSocketEvent("message:new", (payload) => {
    const { conversationId } = payload
    if (!qc.getQueryData(messagesKey(conversationId))) return
    const quoted = payload.replyToId
      ? findCachedMessage(qc, conversationId, payload.replyToId)
      : undefined
    const message: ChatMessage = {
      ...payload,
      data: (payload.data ?? null) as ChatMessage["data"],
      attachments: [],
      reactions: [],
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
