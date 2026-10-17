import { cn } from "cn"
import {
  differenceInMinutes,
  format,
  isSameDay,
  isToday,
  isYesterday,
} from "date-fns"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Marker, MarkerContent } from "@/components/ui/marker"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { useDbInfinite } from "@/lib/query"
import {
  type ChatMessage,
  fetchMessages,
  MESSAGE_PAGE_SIZE,
  messagesKey,
  type ThreadConversation,
  type ThreadMember,
} from "./chat-data"
import { type MessageActions, MessageRow } from "./message-row"

const GROUP_WINDOW_MIN = 5
const TIME_GAP_MIN = 60

function dayLabel(d: Date) {
  if (isToday(d)) return "Today"
  if (isYesterday(d)) return "Yesterday"
  return format(
    d,
    d.getFullYear() === new Date().getFullYear()
      ? "EEEE, MMMM d"
      : "MMMM d, yyyy"
  )
}

type Props = {
  conversation: ThreadConversation
  members: ThreadMember[]
  actions: Omit<MessageActions, "onJumpTo">
}

export function MessageList({ conversation, members, actions }: Props) {
  const { me } = useOrg()
  const {
    data,
    isPending,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDbInfinite<ChatMessage>(
    messagesKey(conversation.id),
    (cursor) => fetchMessages(conversation.id, cursor),
    MESSAGE_PAGE_SIZE
  )

  if (isPending) return <ThreadSkeleton />
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
        Could not load messages.
      </div>
    )
  }

  // pages are newest-first; render oldest → newest
  const messages = data.pages.flat().reverse()
  const myMember = members.find((m) => m.userId === me.id)

  return (
    <Thread
      conversation={conversation}
      members={members}
      messages={messages}
      myLastReadAt={myMember?.lastReadAt}
      actions={actions}
      hasOlder={Boolean(hasNextPage)}
      loadingOlder={isFetchingNextPage}
      loadOlder={() => void fetchNextPage()}
    />
  )
}

function Thread({
  conversation,
  members,
  messages,
  myLastReadAt,
  actions,
  hasOlder,
  loadingOlder,
  loadOlder,
}: Props & {
  messages: ChatMessage[]
  myLastReadAt: Date | undefined
  hasOlder: boolean
  loadingOlder: boolean
  loadOlder: () => void
}) {
  const { me } = useOrg()
  const viewportRef = useRef<HTMLDivElement>(null)
  const { scrollToMessage } = useMessageScroller()
  const [highlight, setHighlight] = useState<string | null>(null)
  const isGroup = conversation.type === "GROUP"

  // conversations shorter than the viewport: keep loading until it scrolls (or history ends)
  const count = messages.length
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !hasOlder || loadingOlder || count === 0) return
    if (el.scrollHeight <= el.clientHeight + 40) loadOlder()
  }, [count, hasOlder, loadingOlder, loadOlder])

  useEffect(() => {
    if (!highlight) return
    const t = setTimeout(() => setHighlight(null), 1600)
    return () => clearTimeout(t)
  }, [highlight])

  const jumpTo = (id: string) => {
    if (!messages.some((m) => m.id === id)) {
      toast("That message is further back in the conversation", {
        description: "Scroll up to load older messages.",
      })
      return
    }
    scrollToMessage(id, { align: "center", behavior: "smooth" })
    setHighlight(id)
  }

  useMarkRead(conversation.id, messages, myLastReadAt)

  // delivery / read state under my latest message, when it's the newest one
  const last = messages.at(-1)
  let status: string | null = null
  if (
    last &&
    last.senderId === me.id &&
    last.type === "TEXT" &&
    !last.pending
  ) {
    const others = members.filter((m) => m.userId !== me.id)
    const seenBy = others.filter((m) => m.lastReadAt >= last.createdAt)
    if (!isGroup) status = seenBy.length ? "Seen" : "Sent"
    else if (others.length && seenBy.length === others.length)
      status = "Seen by everyone"
    else if (seenBy.length)
      status = `Seen by ${seenBy.map((m) => m.user.name.split(/\s+/)[0]).join(", ")}`
    else status = "Sent"
  }

  const sameGroup = (a: ChatMessage | undefined, b: ChatMessage | undefined) =>
    Boolean(
      a &&
      b &&
      a.type === "TEXT" &&
      b.type === "TEXT" &&
      a.senderId === b.senderId &&
      isSameDay(a.createdAt, b.createdAt) &&
      Math.abs(differenceInMinutes(b.createdAt, a.createdAt)) < GROUP_WINDOW_MIN
    )

  return (
    <MessageScroller className="flex-1">
      <MessageScrollerViewport
        ref={viewportRef}
        aria-label="Messages"
        className="flex flex-col"
        onScroll={(e) => {
          if (hasOlder && !loadingOlder && e.currentTarget.scrollTop < 400)
            loadOlder()
        }}
      >
        <div className="flex h-12 shrink-0 items-center justify-center text-xs text-muted-foreground">
          {loadingOlder ? (
            <Spinner />
          ) : !hasOlder && messages.length > 0 ? (
            <span>This is the beginning of the conversation</span>
          ) : null}
        </div>
        <MessageScrollerContent className="mt-auto h-max min-h-0 gap-0 px-3 pb-3 md:px-6">
          {messages.length === 0 ? (
            <MessageScrollerItem className="py-10 text-center text-sm text-muted-foreground">
              No messages yet. Say hi 👋
            </MessageScrollerItem>
          ) : null}
          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const next = messages[i + 1]
            const newDay = !prev || !isSameDay(prev.createdAt, m.createdAt)
            const gap =
              !newDay &&
              prev &&
              differenceInMinutes(m.createdAt, prev.createdAt) >= TIME_GAP_MIN
            const first = !sameGroup(prev, m)
            return (
              <MessageScrollerItem
                key={m.id}
                messageId={m.id}
                className={cn(
                  "rounded-xl transition-colors duration-700",
                  first ? "pt-3" : "pt-0.5",
                  highlight === m.id && "bg-primary/10"
                )}
              >
                {newDay ? (
                  <Marker variant="separator" className="py-3 text-xs">
                    <MarkerContent>{dayLabel(m.createdAt)}</MarkerContent>
                  </Marker>
                ) : gap ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    {format(m.createdAt, "HH:mm")}
                  </p>
                ) : null}
                <MessageRow
                  message={m}
                  conversationId={conversation.id}
                  isGroup={isGroup}
                  firstInGroup={first}
                  lastInGroup={!sameGroup(m, next)}
                  status={m === last ? status : null}
                  actions={{ ...actions, onJumpTo: jumpTo }}
                />
              </MessageScrollerItem>
            )
          })}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton className="shadow-md" />
    </MessageScroller>
  )
}

/**
 * Marks the conversation read when the newest message is on screen and the window is focused.
 * Debounced, and at most once per newest message so the resulting `conversation:read` echo
 * can't loop.
 */
function useMarkRead(
  conversationId: string,
  messages: ChatMessage[],
  myLastReadAt: Date | undefined
) {
  const { me } = useOrg()
  const { visibleMessageIds } = useMessageScrollerVisibility()
  const [focused, setFocused] = useState(false)
  const markedRef = useRef<string | null>(null)

  useEffect(() => {
    const update = () =>
      setFocused(document.visibilityState === "visible" && document.hasFocus())
    update()
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    document.addEventListener("visibilitychange", update)
    return () => {
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])

  const newest = messages.findLast((m) => !m.pending)
  const newestId = newest?.id
  const newestAt = new Date(newest?.createdAt || "").getTime()
  const shouldMark = Boolean(
    newestId &&
    newestAt !== undefined &&
    focused &&
    myLastReadAt &&
    newestAt > myLastReadAt.getTime() &&
    visibleMessageIds.includes(newestId)
  )

  useEffect(() => {
    if (
      !shouldMark ||
      !newestId ||
      newestAt === undefined ||
      markedRef.current === newestId
    )
      return
    const t = setTimeout(() => {
      markedRef.current = newestId
      db.conversationMember
        .update({
          where: { conversationId_userId: { conversationId, userId: me.id } },
          // never before the message itself, even with a skewed client clock
          data: { lastReadAt: new Date(Math.max(Date.now(), newestAt + 1)) },
          select: { id: true },
        })
        .catch(() => {
          markedRef.current = null
        })
    }, 400)
    return () => clearTimeout(t)
  }, [shouldMark, newestId, newestAt, conversationId, me.id])
}

function ThreadSkeleton() {
  const rows = [
    { mine: false, w: "w-48" },
    { mine: false, w: "w-64" },
    { mine: true, w: "w-40" },
    { mine: false, w: "w-56" },
    { mine: true, w: "w-72" },
    { mine: true, w: "w-32" },
  ]
  return (
    <div
      className="flex flex-1 flex-col justify-end gap-3 overflow-hidden px-3 py-4 md:px-6"
      aria-hidden="true"
    >
      {rows.map((r, i) => (
        <div
          key={`${i}-${r.w}`}
          className={cn("flex items-end gap-2", r.mine && "flex-row-reverse")}
        >
          {!r.mine ? <Skeleton className="size-7 rounded-full" /> : null}
          <Skeleton className={cn("h-9 rounded-2xl", r.w)} />
        </div>
      ))}
    </div>
  )
}
