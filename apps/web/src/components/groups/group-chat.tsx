import { useQuery } from "@tanstack/react-query"
import { MessageCircleOffIcon } from "lucide-react"
import { ChatThread } from "@/components/chat/chat-thread"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api-client"
import type { GroupCallState } from "@/lib/realtime-events"
import { GroupCallButton } from "./group-call-bar"

/**
 * The group chat: the group's Conversation, created on first open by the API (find-or-create, so
 * the request is idempotent). Everything else is the regular chat thread.
 */
export function GroupChat({
  groupId,
  live,
}: {
  groupId: string
  live: GroupCallState | null
}) {
  const { data, isPending, error } = useQuery({
    // not under "conversation": every `message:new` invalidates that model, and this is a POST
    queryKey: ["groupChat", groupId],
    queryFn: () =>
      api.post<{ id: string }>(`/api/groups/${groupId}/conversation`),
    staleTime: Infinity,
  })

  return (
    <div className="flex h-[calc(100svh-12rem)] min-h-112 flex-col overflow-hidden rounded-xl border bg-card">
      {isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      ) : error || !data ? (
        <Empty className="flex-1 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageCircleOffIcon />
            </EmptyMedia>
            <EmptyTitle>Chat unavailable</EmptyTitle>
            <EmptyDescription>
              {error?.message ?? "Only group members can use the group chat."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ChatThread
          key={data.id}
          conversationId={data.id}
          variant="panel"
          actions={<GroupCallButton groupId={groupId} live={live} />}
        />
      )}
    </div>
  )
}
