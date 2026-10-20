import { cn } from "cn"
import {
  BellOffIcon,
  InboxIcon,
  MessageCirclePlusIcon,
  MessagesSquareIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { type ReactNode, useState } from "react"
import { useQueryState } from "nuqs"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  SidebarCount,
  SidebarSection,
  sidebarRowClass,
} from "@/components/common/sidebar-list"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useApp } from "@/hooks/use-app"
import { useNow } from "@/hooks/use-now"
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

type Row = { item: ConversationListItem; title: string }

/** Chat-only sidebar: quick filters, then Groups and Direct messages sections. */
export function ConversationList({ activeId }: { activeId?: string }) {
  const { t } = useTranslation()
  const { me } = useApp()
  const now = useNow()
  const [q, setQ] = useState("")
  const [filter, setFilter] = useQueryState("filter", chatFilterParser)
  const { data, isPending, error } = useDbQuery(conversationListKey(), () =>
    fetchConversationList(me.id)
  )

  const rows: Row[] = (data ?? []).map((item) => ({
    item,
    title: conversationTitle(
      item.conversation,
      item.conversation.members,
      me.id
    ),
  }))
  const isMuted = (item: ConversationListItem) =>
    Boolean(item.mutedUntil && item.mutedUntil.getTime() > now)
  const unreadCount = rows.filter(({ item }) => isUnread(item, me.id)).length
  const mutedCount = rows.filter(({ item }) => isMuted(item)).length

  const term = q.trim().toLowerCase()
  const visible = rows.filter(({ item, title }) => {
    if (filter === "unread" && !isUnread(item, me.id)) return false
    if (filter === "muted" && !isMuted(item)) return false
    if (!term) return true
    return (
      title.toLowerCase().includes(term) ||
      item.conversation.members.some((m) =>
        m.user.name.toLowerCase().includes(term)
      )
    )
  })
  const groups = visible.filter((r) => r.item.conversation.type === "GROUP")
  const direct = visible.filter((r) => r.item.conversation.type === "DIRECT")

  const quickFilters: {
    value: ChatFilter
    label: string
    icon: ReactNode
    count?: number
  }[] = [
    { value: "all", label: t("chat.list.all"), icon: <MessagesSquareIcon /> },
    {
      value: "unread",
      label: t("chat.list.unread"),
      icon: <InboxIcon />,
      count: unreadCount,
    },
    {
      value: "muted",
      label: t("chat.list.muted"),
      icon: <BellOffIcon />,
      count: mutedCount,
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/40">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <h1 className="text-sm font-semibold">{t("chat.chats")}</h1>
        <Tooltip>
          <NewConversationDialog>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("chat.list.newMessage")}
              >
                <SquarePenIcon />
              </Button>
            </TooltipTrigger>
          </NewConversationDialog>
          <TooltipContent>{t("chat.list.newMessage")}</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 px-2 py-3">
          <div className="flex flex-col gap-0.5">
            <div className="relative mb-1.5 px-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQ("")}
                placeholder={t("chat.list.search")}
                aria-label={t("chat.list.search")}
                className="h-8 bg-card pl-7 text-xs shadow-none md:text-xs"
              />
            </div>
            {quickFilters.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() =>
                  void setFilter(f.value === "all" ? null : f.value)
                }
                className={cn(
                  sidebarRowClass,
                  "text-left [&_svg]:size-3.5 [&_svg]:text-muted-foreground",
                  filter === f.value && "bg-accent font-medium"
                )}
              >
                {f.icon}
                <span className="flex-1 truncate">{f.label}</span>
                {f.count ? <SidebarCount>{f.count}</SidebarCount> : null}
              </button>
            ))}
          </div>

          {isPending ? (
            <ListSkeleton />
          ) : error ? (
            <p className="px-3 py-6 text-center text-xs text-destructive">
              {t("chat.list.loadFailed")}
            </p>
          ) : rows.length === 0 ? (
            <Empty className="border-0 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCirclePlusIcon />
                </EmptyMedia>
                <EmptyTitle>{t("chat.list.emptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("chat.list.emptyBody")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <NewConversationDialog>
                  <Button size="sm">{t("chat.list.newMessage")}</Button>
                </NewConversationDialog>
              </EmptyContent>
            </Empty>
          ) : visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {term
                ? t("chat.list.noMatch", { q: q.trim() })
                : t("chat.list.noChats")}
            </p>
          ) : (
            <>
              <Section
                id="groups"
                label={t("chat.list.groups")}
                addLabel={t("chat.list.newGroup")}
              >
                {groups.map((r) => (
                  <ConversationRow
                    key={r.item.conversation.id}
                    {...r}
                    muted={isMuted(r.item)}
                    active={r.item.conversation.id === activeId}
                  />
                ))}
              </Section>
              <Section
                id="direct"
                label={t("chat.list.direct")}
                addLabel={t("chat.list.newDirect")}
              >
                {direct.map((r) => (
                  <ConversationRow
                    key={r.item.conversation.id}
                    {...r}
                    muted={isMuted(r.item)}
                    active={r.item.conversation.id === activeId}
                  />
                ))}
              </Section>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

const SECTION_KEY = "chat:sidebar:collapsed"

function Section({
  id,
  label,
  addLabel,
  children,
}: {
  id: string
  label: string
  addLabel: string
  children: ReactNode[]
}) {
  return (
    <SidebarSection
      id={id}
      storageKey={SECTION_KEY}
      label={label}
      action={
        <Tooltip>
          <NewConversationDialog>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={addLabel}
                className="text-muted-foreground"
              >
                <PlusIcon />
              </Button>
            </TooltipTrigger>
          </NewConversationDialog>
          <TooltipContent>{addLabel}</TooltipContent>
        </Tooltip>
      }
    >
      {children}
    </SidebarSection>
  )
}

function ConversationRow({
  item,
  title,
  active,
  muted,
}: Row & { active: boolean; muted: boolean }) {
  const { t } = useTranslation()
  const { me } = useApp()
  const { conversation } = item
  const unread = isUnread(item, me.id)
  const preview = conversation.messages[0]?.content

  return (
    <Link
      to={`/chat/${conversation.id}`}
      aria-current={active ? "page" : undefined}
      title={preview || undefined}
      className={cn(sidebarRowClass, active && "bg-accent")}
    >
      <ConversationAvatar
        type={conversation.type}
        group={conversation.group}
        members={conversation.members}
        meId={me.id}
        size="sm"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          unread && !muted ? "font-semibold" : "font-normal",
          muted && "text-muted-foreground"
        )}
      >
        {title}
      </span>
      {muted ? (
        <BellOffIcon
          className="size-3 shrink-0 text-muted-foreground"
          aria-label={t("chat.list.muted")}
        />
      ) : unread ? (
        <span
          role="img"
          aria-label={t("chat.list.unread")}
          className="size-1.5 shrink-0 rounded-full bg-primary"
        />
      ) : null}
    </Link>
  )
}

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
    <div className="flex flex-col gap-2 px-2" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}
