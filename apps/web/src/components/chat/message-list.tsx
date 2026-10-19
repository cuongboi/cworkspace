import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "cn"
import {
  differenceInMinutes,
  format,
  isSameDay,
  isToday,
  isYesterday,
} from "date-fns"
import { ArrowDownIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useApp } from "@/hooks/use-app"
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
import {
  type ThreadScrollHandle,
  useRegisterThreadScroll,
} from "./thread-scroll"

const GROUP_WINDOW_MIN = 5
const TIME_GAP_MIN = 60
/** the "beginning of the conversation" / loading strip above the first message */
const STATUS_ROW_HEIGHT = 48

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
  const { me } = useApp()
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
  const { me } = useApp()
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  // snapshot: the live marker moves as soon as we mark read, which would hide the divider
  const [lastReadAtOpen] = useState(myLastReadAt)
  const isGroup = conversation.type === "GROUP"
  const count = messages.length

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => viewport,
    estimateSize: () => 64,
    getItemKey: (i) => messages[i]?.id ?? i,
    overscan: 10,
    paddingStart: STATUS_ROW_HEIGHT,
    paddingEnd: 12,
    // chat semantics: prepending older pages keeps the same message under the reader, resizes
    // (images loading, edits) keep the bottom pinned, and new messages are followed when the
    // reader is already at the bottom
    anchorTo: "end",
    followOnAppend: "smooth",
    scrollEndThreshold: 80,
  })
  const items = virtualizer.getVirtualItems()
  const atEnd = virtualizer.isAtEnd(200)
  const visibleEnd = virtualizer.range?.endIndex ?? -1

  const scrollHandle = useMemo<ThreadScrollHandle>(
    () => ({ scrollToEnd: (options) => virtualizer.scrollToEnd(options) }),
    [virtualizer]
  )
  useRegisterThreadScroll(scrollHandle)

  // open at the newest message; hidden for a frame so the jump from the top isn't visible
  useLayoutEffect(() => {
    if (!viewport) return
    virtualizer.scrollToEnd()
    const raf = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(raf)
  }, [viewport, virtualizer])

  // conversations shorter than the viewport: keep loading until it scrolls (or history ends)
  useEffect(() => {
    if (!viewport || !hasOlder || loadingOlder || count === 0) return
    if (viewport.scrollHeight <= viewport.clientHeight + 40) loadOlder()
  }, [viewport, count, hasOlder, loadingOlder, loadOlder])

  useEffect(() => {
    if (!highlight) return
    const t = setTimeout(() => setHighlight(null), 1600)
    return () => clearTimeout(t)
  }, [highlight])

  const jumpTo = (id: string) => {
    const index = messages.findIndex((m) => m.id === id)
    if (index === -1) {
      toast("That message is further back in the conversation", {
        description: "Scroll up to load older messages.",
      })
      return
    }
    virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" })
    setHighlight(id)
  }

  useMarkRead(conversation.id, messages, myLastReadAt, visibleEnd)

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
      a.type === b.type &&
      (a.type === "TEXT" || a.type === "BOT") &&
      a.senderId === b.senderId &&
      a.integrationId === b.integrationId &&
      isSameDay(a.createdAt, b.createdAt) &&
      Math.abs(differenceInMinutes(b.createdAt, a.createdAt)) < GROUP_WINDOW_MIN
    )

  const statusRow = (
    <div
      className="absolute inset-x-0 top-0 flex items-center justify-center text-xs text-muted-foreground"
      style={{ height: STATUS_ROW_HEIGHT }}
    >
      {loadingOlder ? (
        <Spinner />
      ) : !hasOlder && count > 0 ? (
        <span>This is the beginning of the conversation</span>
      ) : null}
    </div>
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={setViewport}
        role="log"
        aria-label="Messages"
        className={cn(
          "flex size-full min-h-0 min-w-0 scrollbar-thin scrollbar-gutter-stable flex-col overflow-y-auto overscroll-contain [overflow-anchor:none]",
          !ready && "invisible"
        )}
        onScroll={(e) => {
          if (
            ready &&
            hasOlder &&
            !loadingOlder &&
            e.currentTarget.scrollTop < 400
          )
            loadOlder()
        }}
      >
        {count === 0 ? (
          <div className="relative mt-auto">
            <div style={{ height: STATUS_ROW_HEIGHT }} />
            <p className="py-10 text-center text-sm text-muted-foreground">
              No messages yet. Say hi 👋
            </p>
          </div>
        ) : (
          // mt-auto bottom-aligns conversations shorter than the viewport
          <div
            className="relative mt-auto w-full shrink-0"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {statusRow}
            {items.map((item) => {
              const m = messages[item.index]
              if (!m) return null
              const prev = messages[item.index - 1]
              const next = messages[item.index + 1]
              const newDay = !prev || !isSameDay(prev.createdAt, m.createdAt)
              const gap =
                !newDay &&
                prev &&
                differenceInMinutes(m.createdAt, prev.createdAt) >= TIME_GAP_MIN
              const first = !sameGroup(prev, m)
              const lastRead = Boolean(
                lastReadAtOpen &&
                prev &&
                m.senderId !== me.id &&
                prev.createdAt <= lastReadAtOpen &&
                m.createdAt > lastReadAtOpen
              )
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute inset-x-0 top-0 px-3 md:px-8"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <div
                    className={cn(
                      "mx-auto max-w-5xl min-w-0 rounded-md transition-colors duration-700",
                      first ? "pt-5" : "pt-0.5",
                      highlight === m.id && "bg-primary/10"
                    )}
                  >
                    {lastRead ? (
                      <Marker
                        variant="separator"
                        className="py-2 text-xs font-semibold text-foreground"
                      >
                        <MarkerContent>Last read</MarkerContent>
                      </Marker>
                    ) : null}
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
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Scroll to newest message"
        tabIndex={atEnd ? -1 : 0}
        aria-hidden={atEnd}
        onClick={() => virtualizer.scrollToEnd({ behavior: "smooth" })}
        className={cn(
          "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border-border bg-background shadow-md transition-[translate,scale,opacity] duration-200 hover:bg-muted",
          atEnd
            ? "pointer-events-none translate-y-full scale-95 opacity-0"
            : "translate-y-0 scale-100 opacity-100"
        )}
      >
        <ArrowDownIcon />
      </Button>
    </div>
  )
}

/**
 * Marks the conversation read when the newest message is on screen (`visibleEnd` is the last
 * index in the viewport) and the window is focused.
 * Debounced, and at most once per newest message so the resulting `conversation:read` echo
 * can't loop.
 */
function useMarkRead(
  conversationId: string,
  messages: ChatMessage[],
  myLastReadAt: Date | undefined,
  visibleEnd: number
) {
  const { me } = useApp()
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

  const newestIndex = messages.findLastIndex((m) => !m.pending)
  const newest = messages[newestIndex]
  const newestId = newest?.id
  const newestAt = new Date(newest?.createdAt || "").getTime()
  const shouldMark = Boolean(
    newestId &&
    newestAt !== undefined &&
    focused &&
    myLastReadAt &&
    newestAt > myLastReadAt.getTime() &&
    visibleEnd >= newestIndex
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
          <Skeleton className={cn("h-9 rounded-md", r.w)} />
        </div>
      ))}
    </div>
  )
}
