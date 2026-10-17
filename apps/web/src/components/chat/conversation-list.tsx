import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "cn"
import {
  BellOffIcon,
  MessageCirclePlusIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useState } from "react"
import { shortTime } from "@/components/common/time-ago"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useApp } from "@/hooks/use-app"
import { toPlainText } from "@/lib/mentions"
import { useDbQuery } from "@/lib/query"
import {
  type ConversationListItem,
  callLabel,
  conversationListKey,
  conversationTitle,
  fetchConversationList,
  parseCallData,
} from "./chat-data"
import { ConversationAvatar } from "./conversation-avatar"
import { NewConversationDialog } from "./new-conversation-dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

export function ConversationList({ activeId }: { activeId?: string }) {
  const { me } = useApp()
  const [q, setQ] = useState("")
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const { data, isPending, error } = useDbQuery(conversationListKey(), () =>
    fetchConversationList(me.id)
  )

  const term = q.trim().toLowerCase()
  const rows = (data ?? []).map((item) => ({
    item,
    title: conversationTitle(
      item.conversation,
      item.conversation.members,
      me.id
    ),
  }))
  const filtered = term
    ? rows.filter(
        ({ item, title }) =>
          title.toLowerCase().includes(term) ||
          item.conversation.members.some((m) =>
            m.user.name.toLowerCase().includes(term)
          )
      )
    : rows

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <h1 className="text-2xl font-bold tracking-tight">Chats</h1>
        <Tooltip>
          <NewConversationDialog>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full"
                aria-label="New message"
              >
                <SquarePenIcon />
              </Button>
            </TooltipTrigger>
          </NewConversationDialog>
          <TooltipContent>New message</TooltipContent>
        </Tooltip>
      </div>
      <div className="px-4 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search chats"
            aria-label="Search chats"
            className="rounded-full bg-muted pl-9 shadow-none"
          />
        </div>
      </div>

      <ScrollArea viewportRef={setViewport} className="min-h-0 flex-1">
        <nav aria-label="Conversations" className="px-2 pb-2">
          {isPending ? (
            <ListSkeleton />
          ) : error ? (
            <p className="px-3 py-6 text-center text-sm text-destructive">
              Could not load conversations.
            </p>
          ) : rows.length === 0 ? (
            <Empty className="border-0 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCirclePlusIcon />
                </EmptyMedia>
                <EmptyTitle>No conversations yet</EmptyTitle>
                <EmptyDescription>
                  Message a coworker or start a group chat.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <NewConversationDialog>
                  <Button>New message</Button>
                </NewConversationDialog>
              </EmptyContent>
            </Empty>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No chats match “{q.trim()}”
            </p>
          ) : (
            <VirtualConversationRows
              rows={filtered}
              activeId={activeId}
              scrollElement={viewport}
            />
          )}
        </nav>
      </ScrollArea>
    </div>
  )
}

function VirtualConversationRows({
  rows,
  activeId,
  scrollElement,
}: {
  rows: { item: ConversationListItem; title: string }[]
  activeId?: string
  scrollElement: HTMLElement | null
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 56,
    getItemKey: (i) => rows[i]?.item.conversation.id ?? i,
    gap: 2,
    overscan: 8,
  })

  return (
    <ul
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((v) => {
        const row = rows[v.index]
        if (!row) return null
        return (
          <li
            key={v.key}
            data-index={v.index}
            ref={virtualizer.measureElement}
            aria-setsize={rows.length}
            aria-posinset={v.index + 1}
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${v.start}px)` }}
          >
            <ConversationRow
              item={row.item}
              title={row.title}
              active={row.item.conversation.id === activeId}
            />
          </li>
        )
      })}
    </ul>
  )
}

function ConversationRow({
  item,
  title,
  active,
}: {
  item: ConversationListItem
  title: string
  active: boolean
}) {
  const { me } = useApp()
  const { conversation } = item
  const last = conversation.messages[0]
  const unread = Boolean(
    last &&
    last.senderId !== me.id &&
    conversation.lastMessageAt > item.lastReadAt
  )
  const muted = Boolean(item.mutedUntil && item.mutedUntil > new Date())

  let preview = "No messages yet"
  if (last) {
    const sender =
      last.senderId === me.id
        ? "You"
        : conversation.type === "GROUP"
          ? (conversation.members
              .find((m) => m.userId === last.senderId)
              ?.user.name.split(/\s+/)[0] ?? "")
          : ""
    let text: string
    if (last.type === "CALL") text = callLabel(parseCallData(last.data))
    else if (last.type === "SYSTEM") text = toPlainText(last.content)
    else if (last.deletedAt) text = "Unsent a message"
    else if (last.content.trim())
      text = toPlainText(last.content).replace(/\s+/g, " ")
    else if (last._count.attachments)
      text = `Sent ${last._count.attachments === 1 ? "an attachment" : `${last._count.attachments} attachments`}`
    else text = ""
    preview = sender && last.type === "TEXT" ? `${sender}: ${text}` : text
  }

  return (
    <Link
      to={`/chat/${conversation.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-2 py-2 transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-accent"
      )}
    >
      <ConversationAvatar
        type={conversation.type}
        group={conversation.group}
        members={conversation.members}
        meId={me.id}
        size="lg"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span
            className={cn(
              "truncate text-sm",
              unread ? "font-semibold" : "font-medium"
            )}
          >
            {title}
          </span>
          {muted ? (
            <BellOffIcon
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Muted"
            />
          ) : null}
        </div>
        <div
          className={cn(
            "flex items-center gap-1 text-xs",
            unread ? "font-semibold text-foreground" : "text-muted-foreground"
          )}
        >
          <span className="min-w-0 truncate">{preview}</span>
          {last ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="shrink-0" suppressHydrationWarning>
                {shortTime(conversation.lastMessageAt)}
              </span>
            </>
          ) : null}
        </div>
      </div>
      {unread ? (
        <span
          role="img"
          aria-label="Unread"
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            muted ? "bg-muted-foreground" : "bg-primary"
          )}
        />
      ) : null}
    </Link>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-2" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  )
}
