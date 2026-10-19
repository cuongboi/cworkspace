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
import { Spinner } from "@/components/ui/spinner"
import { useIsMobile } from "@/hooks/use-mobile"
import { ApiError, api } from "@/lib/api-client"
import { ChatThread } from "./chat-thread"
import { ConversationList } from "./conversation-list"
import { NewConversationDialog } from "./new-conversation-dialog"

/**
 * Chat layout: chat sidebar | thread (| details column, owned by the thread). On mobile only
 * one pane is shown: the list at /chat, the thread at /chat/[id].
 */
export function ChatShell({ conversationId }: { conversationId?: string }) {
  const isMobile = useIsMobile()
  const opening = useOpenDirectFromQuery()

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
    <div className="h-full min-h-0 overflow-hidden">
      {isMobile ? (
        conversationId || opening ? (
          thread
        ) : (
          <ConversationList />
        )
      ) : (
        <div className="flex h-full min-h-0">
          <aside className="w-60 shrink-0 border-r">
            <ConversationList activeId={conversationId} />
          </aside>
          <div className="min-w-0 flex-1">{thread}</div>
        </div>
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
  const [searchParams] = useSearchParams()
  const withUser = searchParams.get("with") ?? undefined
  const startedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!withUser || startedRef.current === withUser) return
    startedRef.current = withUser
    api
      .post<{ id: string }>("/api/conversations/direct", {
        userId: withUser,
      })
      .then(({ id }) => navigate(`/chat/${id}`, { replace: true }))
      .catch((err: unknown) => {
        toast.error(
          err instanceof ApiError
            ? err.message
            : "Could not open the conversation"
        )
        void navigate("/chat", { replace: true })
      })
      .finally(() => {
        startedRef.current = null
      })
  }, [withUser, navigate])

  return Boolean(withUser)
}
