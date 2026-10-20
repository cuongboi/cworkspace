import { format } from "date-fns"
import { SearchIcon } from "lucide-react"
import { useQueryState } from "nuqs"
import { useTranslation } from "react-i18next"
import { type ReactNode, useEffect, useState } from "react"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useDateLocale } from "@/lib/i18n"
import { toPlainText } from "@/lib/mentions"
import { useDbInfinite } from "@/lib/query"
import { chatSearchParser } from "@/lib/search-params"
import {
  MESSAGE_PAGE_SIZE,
  type MessageSearchHit,
  messageSearchKey,
  searchMessages,
} from "./chat-data"
import { useThreadScroll } from "./thread-scroll"

const MIN_QUERY = 2

/** Search within one conversation (DM, group chat or channel); a hit scrolls the thread to it. */
export function MessageSearch({
  conversationId,
  onPick,
}: {
  conversationId: string
  /** called after jumping, so a sheet host can close itself */
  onPick?: () => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useQueryState("mq", chatSearchParser)
  const [input, setInput] = useState(q)
  const { jumpTo } = useThreadScroll()

  useEffect(() => {
    const t = setTimeout(() => void setQ(input.trim() || null), 300)
    return () => clearTimeout(t)
  }, [input, setQ])

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("chat.search.placeholder")}
          aria-label={t("chat.search.placeholder")}
          className="h-8 pl-8 text-xs"
        />
      </div>
      {q.length >= MIN_QUERY ? (
        <Results
          key={q}
          conversationId={conversationId}
          q={q}
          onPick={(id) => {
            jumpTo(id)
            onPick?.()
          }}
        />
      ) : (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("chat.search.minChars", { count: MIN_QUERY })}
        </p>
      )}
    </div>
  )
}

function Results({
  conversationId,
  q,
  onPick,
}: {
  conversationId: string
  q: string
  onPick: (id: string) => void
}) {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const {
    data,
    isPending,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDbInfinite<MessageSearchHit>(
    messageSearchKey(conversationId, q),
    (cursor) => searchMessages(conversationId, q, cursor),
    MESSAGE_PAGE_SIZE
  )

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <p className="py-6 text-center text-xs text-destructive">
        {t("chat.search.failed")}
      </p>
    )
  }
  const hits = data.pages.flat()
  if (!hits.length) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">
        {t("chat.search.noMatch", { q })}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {hits.map((hit) => (
        <button
          key={hit.id}
          type="button"
          onClick={() => onPick(hit.id)}
          className="flex gap-2.5 rounded-lg p-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserAvatar user={hit.sender} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-xs font-medium">
                {hit.sender.name}
              </span>
              <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                {format(hit.createdAt, "PP", { locale })}
              </span>
            </span>
            <span className="line-clamp-2 text-xs break-words text-muted-foreground">
              <Snippet text={toPlainText(hit.content)} q={q} />
            </span>
          </span>
        </button>
      ))}
      {hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 text-xs"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? t("common.loading") : t("common.loadMore")}
        </Button>
      ) : null}
    </div>
  )
}

/** Centers the first match in long messages and marks every occurrence of the query. */
function Snippet({ text, q }: { text: string; q: string }) {
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const first = lower.indexOf(needle)
  const start = first > 40 ? first - 30 : 0
  const shown = (start ? "…" : "") + text.slice(start)
  const parts: ReactNode[] = []
  const shownLower = shown.toLowerCase()
  let last = 0
  for (
    let i = shownLower.indexOf(needle);
    i !== -1;
    i = shownLower.indexOf(needle, i + needle.length)
  ) {
    if (i > last) parts.push(shown.slice(last, i))
    parts.push(
      <mark key={i} className="rounded-sm bg-primary/15 text-foreground">
        {shown.slice(i, i + needle.length)}
      </mark>
    )
    last = i + needle.length
  }
  parts.push(shown.slice(last))
  return <>{parts}</>
}
