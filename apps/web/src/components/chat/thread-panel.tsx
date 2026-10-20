import { XIcon } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useApp } from "@/hooks/use-app"
import { useUploads } from "@/hooks/use-uploads"
import { useDbQuery } from "@/lib/query"
import type { ReactionType } from "@app/api/zenstack/models"
import {
  type ChatMessage,
  conversationTitle,
  fetchMessage,
  fetchThreadReplies,
  type ThreadConversation,
  type ThreadMember,
  threadRepliesKey,
} from "./chat-data"
import { Composer, type ComposerMode } from "./composer"
import { MessageRow } from "./message-row"
import {
  ThreadScrollProvider,
  type ThreadScrollHandle,
  useRegisterThreadScroll,
} from "./thread-scroll"

/** Same sender within 5 minutes continues a run (no repeated avatar/name). */
const RUN_GAP_MS = 5 * 60 * 1000

/** A CHANNEL message's thread: the root, its replies and a reply composer (Slack-style). */
export function ThreadPanel(props: {
  conversation: ThreadConversation
  members: ThreadMember[]
  rootId: string
  isMember: boolean
  onClose: () => void
  onReact: (message: ChatMessage, type: ReactionType) => void
  onDelete: (message: ChatMessage) => void
}) {
  return (
    <ThreadScrollProvider>
      <ThreadPanelView {...props} />
    </ThreadScrollProvider>
  )
}

function ThreadPanelView({
  conversation,
  members,
  rootId,
  isMember,
  onClose,
  onReact,
  onDelete,
}: Parameters<typeof ThreadPanel>[0]) {
  const { t } = useTranslation()
  const { me } = useApp()
  const uploads = useUploads()
  const [mode, setMode] = useState<ComposerMode | null>(null)
  const root = useDbQuery(
    ["message", "findUnique", "thread-root", rootId],
    () => fetchMessage(rootId)
  )
  const replies = useDbQuery(threadRepliesKey(rootId), () =>
    fetchThreadReplies(rootId)
  )

  const actions = {
    onReact,
    onDelete,
    onEdit: (message: ChatMessage) => setMode({ kind: "edit", message }),
    onJumpTo: () => undefined,
  }
  const list = useMemo(
    () => (replies.data ?? []) as ChatMessage[],
    [replies.data]
  )

  // row 0 is the root message + reply divider, then one row per reply
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: root.data ? list.length + 1 : 0,
    getScrollElement: () => viewport,
    estimateSize: () => 64,
    getItemKey: (i) => (i === 0 ? rootId : (list[i - 1]?.id ?? i)),
    overscan: 10,
    paddingStart: 12,
    paddingEnd: 12,
    // keep the newest reply in view as replies arrive or rows resize
    anchorTo: "end",
    followOnAppend: "smooth",
    scrollEndThreshold: 80,
  })

  const handle = useMemo<ThreadScrollHandle>(
    () => ({
      scrollToEnd: (options) => virtualizer.scrollToEnd(options),
      jumpTo: (messageId) => {
        const index =
          messageId === rootId
            ? 0
            : list.findIndex((m) => m.id === messageId) + 1
        if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" })
      },
    }),
    [virtualizer, list, rootId]
  )
  useRegisterThreadScroll(handle)

  // open at the newest reply
  const loaded = Boolean(root.data && replies.data)
  useEffect(() => {
    if (viewport && loaded) virtualizer.scrollToEnd()
  }, [viewport, loaded, virtualizer])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t("chat.threads.title")}</h3>
          <p className="truncate text-2xs text-muted-foreground">
            #{conversationTitle(conversation, members, me.id)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("chat.threads.close")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>

      <div ref={setViewport} className="min-h-0 flex-1 overflow-y-auto">
        {root.isPending ? (
          <div className="flex gap-3 px-4 py-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-10 flex-1" />
          </div>
        ) : !root.data ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("chat.threads.unavailable")}
          </p>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full px-2"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {item.index === 0 ? (
                  <>
                    <MessageRow
                      message={root.data as ChatMessage}
                      conversationId={conversation.id}
                      isGroup
                      firstInGroup
                      lastInGroup
                      actions={actions}
                    />
                    <div className="my-2 flex items-center gap-3 px-2 text-2xs text-muted-foreground">
                      <span>
                        {t("chat.threads.replyCount", { count: list.length })}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  </>
                ) : (
                  <ReplyRow
                    list={list}
                    index={item.index - 1}
                    conversationId={conversation.id}
                    actions={actions}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Composer
        key={rootId}
        conversationId={conversation.id}
        threadId={rootId}
        mode={mode}
        onModeChange={setMode}
        uploads={uploads}
        members={members.map((m) => m.user)}
        isGroup
        disabled={!isMember || !root.data}
      />
    </div>
  )
}

const continues = (a?: ChatMessage, b?: ChatMessage) =>
  Boolean(
    a &&
    b &&
    a.senderId === b.senderId &&
    b.createdAt.getTime() - a.createdAt.getTime() < RUN_GAP_MS
  )

function ReplyRow({
  list,
  index,
  conversationId,
  actions,
}: {
  list: ChatMessage[]
  index: number
  conversationId: string
  actions: Parameters<typeof MessageRow>[0]["actions"]
}) {
  const m = list[index]
  if (!m) return null
  return (
    <MessageRow
      message={m}
      conversationId={conversationId}
      isGroup
      firstInGroup={!continues(list[index - 1], m)}
      lastInGroup={!continues(m, list[index + 1])}
      actions={actions}
    />
  )
}
