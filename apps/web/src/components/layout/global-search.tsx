import { toPlainText } from "@app/shared/mentions"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CornerDownLeftIcon,
  FileIcon,
  FileTextIcon,
  MessageSquareIcon,
  SearchIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { TimeAgo } from "@/components/common/time-ago"
import { UserAvatar } from "@/components/common/user-avatar"
import { messageSearchWhere } from "@/components/chat/chat-data"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { useNow } from "@/hooks/use-now"
import {
  type RecentSearch,
  type RecentSearchKind,
  useRecentSearches,
} from "@/hooks/use-recent-searches"
import { accentFor } from "@/lib/accent"
import { db } from "@/lib/api-client"
import { COMPANY_NAME } from "@/lib/company"
import { useDbQuery } from "@/lib/query"
import { fileUrl } from "@/lib/upload"
import { cn } from "@/lib/utils"

const TABS = [
  { key: "all", label: "All results" },
  { key: "user", label: "People" },
  { key: "group", label: "Groups" },
  { key: "post", label: "Posts" },
  { key: "message", label: "Messages" },
  { key: "file", label: "Files" },
] as const
type Tab = (typeof TABS)[number]["key"]

const MIN_QUERY = 2

type Hit = Omit<RecentSearch, "at">

/** Header trigger + ⌘K command palette searching people, groups, posts, messages and files. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-full max-w-xl items-center gap-2 rounded-lg border bg-card px-2.5 text-sm text-muted-foreground hover:bg-muted sm:flex"
      >
        <SearchIcon className="size-4" />
        <span className="flex-1 text-left">Search</span>
        <Kbd>⌘K</Kbd>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="sm:hidden"
        aria-label="Search"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description={`Search in ${COMPANY_NAME}`}
        className="top-[12%] sm:max-w-2xl"
      >
        {/* mounted only while open, so each opening starts fresh */}
        {open ? <Palette onClose={() => setOpen(false)} /> : null}
      </CommandDialog>
    </>
  )
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const recent = useRecentSearches()
  const [input, setInput] = useState("")
  const [tab, setTab] = useState<Tab>("all")
  const q = useDebounced(input.trim(), 200)
  const searching = q.length >= MIN_QUERY

  const go = (hit: Hit) => {
    recent.add(hit)
    onClose()
    if (hit.kind === "file") window.open(hit.href, "_blank", "noopener")
    else void navigate(hit.href)
  }

  return (
    <Command shouldFilter={false} className="rounded-none! p-0">
      <div className="px-5 pt-4">
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Search in ${COMPANY_NAME}…`}
          aria-label="Search"
          className="h-10 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        <div role="tablist" className="-mb-px flex gap-5 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "shrink-0 border-b-2 border-transparent py-2 text-sm text-muted-foreground hover:text-foreground",
                tab === t.key && "border-foreground font-medium text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <CommandList className="max-h-[min(60vh,420px)] border-t px-3 py-2">
        {searching ? (
          <Results
            q={q}
            tab={tab}
            onSelect={go}
            onSearchAll={() => {
              onClose()
              void navigate(`/search?q=${encodeURIComponent(q)}`)
            }}
          />
        ) : (
          <Recent
            items={recent.items.filter((r) => tab === "all" || r.kind === tab)}
            onSelect={go}
          />
        )}
      </CommandList>
      <footer className="flex items-center gap-4 border-t bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground">
        <Hint
          keys={[<ArrowDownIcon key="d" />, <ArrowUpIcon key="u" />]}
          label="Move"
        />
        <Hint keys={[<CornerDownLeftIcon key="e" />]} label="Select" />
        <span className="ml-auto">
          <Hint keys={["esc"]} label="Cancel" />
        </span>
      </footer>
    </Command>
  )
}

function Hint({ keys, label }: { keys: ReactNode[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((k, i) => (
        <Kbd key={i} className="border bg-background">
          {k}
        </Kbd>
      ))}
      {label}
    </span>
  )
}

function Recent({
  items,
  onSelect,
}: {
  items: RecentSearch[]
  onSelect: (hit: Hit) => void
}) {
  const now = useNow()
  if (!items.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Type at least {MIN_QUERY} characters to search.
      </p>
    )
  }
  const groups = new Map<string, RecentSearch[]>()
  for (const item of items) {
    const label = dayLabel(item.at, now)
    groups.set(label, [...(groups.get(label) ?? []), item])
  }
  return (
    <>
      <p className="px-2 pt-2 text-sm text-muted-foreground">Recent searches</p>
      {[...groups].map(([label, rows]) => (
        <CommandGroup key={label} heading={label}>
          {rows.map((r) => (
            <HitItem key={`${r.kind}:${r.id}`} hit={r} onSelect={onSelect} />
          ))}
        </CommandGroup>
      ))}
    </>
  )
}

function dayLabel(at: number, now: number) {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const diff = Math.round((day(now) - day(at)) / 86_400_000)
  if (diff <= 0) return "Today"
  if (diff === 1) return "Yesterday"
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  })
}

const KIND_ICON: Record<
  Exclude<RecentSearchKind, "user" | "group">,
  ReactNode
> = {
  post: <FileTextIcon />,
  message: <MessageSquareIcon />,
  file: <FileIcon />,
}

function HitItem({ hit, onSelect }: { hit: Hit; onSelect: (h: Hit) => void }) {
  return (
    <CommandItem
      value={`${hit.kind}:${hit.id}`}
      onSelect={() => onSelect(hit)}
      className="h-9 gap-2.5"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {hit.kind === "user" ? (
          <UserAvatar
            user={{ id: hit.id, name: hit.label, image: hit.image ?? null }}
            size="sm"
            className="[&_[data-slot=avatar-fallback]]:text-[9px] [&_[data-slot=avatar]]:size-5"
          />
        ) : hit.kind === "group" ? (
          <span
            className="flex size-5 items-center justify-center rounded-md text-[11px] font-semibold text-white"
            style={{ backgroundColor: accentFor(hit.id) }}
          >
            {hit.label.charAt(0).toUpperCase()}
          </span>
        ) : (
          KIND_ICON[hit.kind]
        )}
      </span>
      <span className="truncate">{hit.label}</span>
      {hit.subtitle ? (
        <span className="truncate text-muted-foreground">— {hit.subtitle}</span>
      ) : null}
      {hit.date ? (
        <TimeAgo
          date={hit.date}
          className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground"
        />
      ) : null}
    </CommandItem>
  )
}

function Results({
  q,
  tab,
  onSelect,
  onSearchAll,
}: {
  q: string
  tab: Tab
  onSelect: (hit: Hit) => void
  onSearchAll: () => void
}) {
  const take = tab === "all" ? 5 : 20
  const on = (kind: Tab) => tab === "all" || tab === kind
  const sections = [
    { kind: "user", title: "People", query: usePeople(q, take, on("user")) },
    { kind: "group", title: "Groups", query: useGroups(q, take, on("group")) },
    { kind: "post", title: "Posts", query: usePosts(q, take, on("post")) },
    {
      kind: "message",
      title: "Messages",
      query: useMessages(q, take, on("message")),
    },
    { kind: "file", title: "Files", query: useFiles(q, take, on("file")) },
  ] as const
  const visible = sections.filter((s) => on(s.kind))
  const pending = visible.some((s) => s.query.isLoading)

  return (
    <>
      {visible.map((s) =>
        s.query.data?.length ? (
          <CommandGroup key={s.kind} heading={s.title}>
            {s.query.data.map((hit) => (
              <HitItem key={hit.id} hit={hit} onSelect={onSelect} />
            ))}
          </CommandGroup>
        ) : null
      )}
      {pending ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : (
        <CommandEmpty>No results for “{q}”.</CommandEmpty>
      )}
      <CommandGroup>
        <CommandItem
          value="search-all"
          onSelect={onSearchAll}
          className="h-9 gap-2.5"
        >
          <SearchIcon />
          Search everything for “{q}”
        </CommandItem>
      </CommandGroup>
    </>
  )
}

const ci = (q: string) => ({ contains: q, mode: "insensitive" as const })

function usePeople(q: string, take: number, enabled: boolean) {
  return useDbQuery(
    ["user", "findMany", "palette", q, take],
    async (): Promise<Hit[]> => {
      const rows = await db.user.findMany({
        where: {
          OR: [{ name: ci(q) }, { title: ci(q) }, { department: ci(q) }],
        },
        select: { id: true, name: true, image: true, title: true },
        orderBy: { name: "asc" },
        take,
      })
      return rows.map((u) => ({
        kind: "user",
        id: u.id,
        label: u.name,
        subtitle: u.title ?? undefined,
        image: u.image,
        href: `/people/${u.id}`,
      }))
    },
    { enabled }
  )
}

function useGroups(q: string, take: number, enabled: boolean) {
  return useDbQuery(
    ["group", "findMany", "palette", q, take],
    async (): Promise<Hit[]> => {
      const rows = await db.group.findMany({
        where: { OR: [{ name: ci(q) }, { description: ci(q) }] },
        select: { id: true, name: true, slug: true, privacy: true },
        orderBy: { name: "asc" },
        take,
      })
      return rows.map((g) => ({
        kind: "group",
        id: g.id,
        label: g.name,
        subtitle: g.privacy.charAt(0) + g.privacy.slice(1).toLowerCase(),
        href: `/groups/${g.slug}`,
      }))
    },
    { enabled }
  )
}

function usePosts(q: string, take: number, enabled: boolean) {
  return useDbQuery(
    ["post", "findMany", "palette", q, take],
    async (): Promise<Hit[]> => {
      const rows = await db.post.findMany({
        where: { content: ci(q) },
        select: {
          id: true,
          content: true,
          createdAt: true,
          group: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
      })
      return rows.map((p) => ({
        kind: "post",
        id: p.id,
        label: snippet(p.content),
        subtitle: p.group.name,
        date: new Date(p.createdAt).toISOString(),
        href: `/posts/${p.id}`,
      }))
    },
    { enabled }
  )
}

function useMessages(q: string, take: number, enabled: boolean) {
  return useDbQuery(
    ["message", "findMany", "palette", q, take],
    async (): Promise<Hit[]> => {
      const rows = await db.message.findMany({
        where: messageSearchWhere(q),
        select: {
          id: true,
          content: true,
          conversationId: true,
          createdAt: true,
          sender: { select: { name: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      })
      return rows.map((m) => ({
        kind: "message",
        id: m.id,
        label: snippet(m.content),
        subtitle: m.sender.name,
        date: new Date(m.createdAt).toISOString(),
        href: `/chat/${m.conversationId}?info=true&infoTab=search&mq=${encodeURIComponent(q)}`,
      }))
    },
    { enabled }
  )
}

function useFiles(q: string, take: number, enabled: boolean) {
  return useDbQuery(
    ["attachment", "findMany", "palette", q, take],
    async (): Promise<Hit[]> => {
      const rows = await db.attachment.findMany({
        where: { name: ci(q), isPublic: false },
        select: {
          id: true,
          name: true,
          createdAt: true,
          uploader: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
      })
      return rows.map((f) => ({
        kind: "file",
        id: f.id,
        label: f.name,
        subtitle: f.uploader.name,
        date: new Date(f.createdAt).toISOString(),
        href: fileUrl(f.id),
      }))
    },
    { enabled }
  )
}

function snippet(text: string) {
  const plain = toPlainText(text).replace(/\s+/g, " ").trim()
  return plain.length > 80 ? `${plain.slice(0, 80)}…` : plain
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return debounced
}
