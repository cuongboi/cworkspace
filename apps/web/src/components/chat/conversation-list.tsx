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
import { useQueryState } from "nuqs"
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
import { useDbQuery } from "@/lib/query"
import { type ChatFilter, chatFilterParser } from "@/lib/search-params"
import {
  type ConversationListItem,
  conversationListKey,
  conversationTitle,
  fetchConversationList,
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
  const [filter, setFilter] = useQueryState("filter", chatFilterParser)
  const byFilter = rows.filter(({ item }) => {
    if (filter === "unread") return isUnread(item, me.id)
    if (filter === "direct") return item.conversation.type === "DIRECT"
    if (filter === "group") return item.conversation.type === "GROUP"
    return true
  })
  const filtered = term
    ? byFilter.filter(
        ({ item, title }) =>
          title.toLowerCase().includes(term) ||
          item.conversation.members.some((m) =>
            m.user.name.toLowerCase().includes(term)
          )
      )
    : byFilter

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/40">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        <h1 className="text-lg font-bold">Chat</h1>
        <div className="flex items-center">
          <Tooltip>
            <NewConversationDialog>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="New message">
                  <SquarePenIcon />
                </Button>
              </TooltipTrigger>
            </NewConversationDialog>
            <TooltipContent>New message</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQ("")}
            placeholder="Search chats"
            aria-label="Search chats"
            className="h-8 bg-card pl-8 shadow-none"
          />
        </div>
      </div>
      <div
        className="flex flex-wrap gap-1.5 border-b px-3 pb-2.5"
        role="tablist"
        aria-label="Filter chats"
      >
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => void setFilter(f.value === "all" ? null : f.value)}
            className={cn(
              "rounded-full border bg-card px-3 py-0.5 text-xs transition-colors hover:bg-accent",
              filter === f.value &&
                "border-foreground bg-foreground text-background hover:bg-foreground/90"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ScrollArea viewportRef={setViewport} className="min-h-0 flex-1">
        <nav aria-label="Conversations" className="px-2 py-2">
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
              {term ? `No chats match “${q.trim()}”` : "No chats here"}
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
    estimateSize: () => 40,
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
  const unread = isUnread(item, me.id)
  const muted = Boolean(item.mutedUntil && item.mutedUntil > new Date())

  return (
    <Link
      to={`/chat/${conversation.id}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-card ring-1 ring-border"
      )}
    >
      <ConversationAvatar
        type={conversation.type}
        group={conversation.group}
        members={conversation.members}
        meId={me.id}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm">
          <span
            className={cn(
              "truncate text-sm",
              unread ? "font-semibold" : "font-normal"
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
      </div>
      {unread ? (
        <span
          role="img"
          aria-label="Unread"
          className={cn(
            "size-2 shrink-0 rounded-full",
            muted ? "bg-muted-foreground" : "bg-primary"
          )}
        />
      ) : null}
    </Link>
  )
}

const FILTERS: { value: ChatFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "direct", label: "Chats" },
  { value: "group", label: "Group chats" },
]

function isUnread(item: ConversationListItem, meId: string) {
  const last = item.conversation.messages[0]
  return Boolean(
    last &&
    last.senderId !== meId &&
    item.conversation.lastMessageAt > item.lastReadAt
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-2" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-2.5 py-1.5">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ))}
    </div>
  )
}
