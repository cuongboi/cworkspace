import { SearchIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"

type Hit = { id: string; title: string; excerpt: string }

const DEBOUNCE_MS = 250

/** Marks every case-insensitive occurrence of `term` in `text`. */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return text
  const lower = text.toLowerCase()
  const needle = term.toLowerCase()
  const parts = []
  let from = 0
  for (
    let at = lower.indexOf(needle);
    at >= 0;
    at = lower.indexOf(needle, from)
  ) {
    parts.push(text.slice(from, at))
    parts.push(
      <mark
        key={at}
        className="rounded-sm bg-yellow-200/70 text-inherit dark:bg-yellow-500/30"
      >
        {text.slice(at, at + needle.length)}
      </mark>
    )
    from = at + needle.length
  }
  parts.push(text.slice(from))
  return parts
}

export function WikiSearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslation()
  // typed text stays local; the URL (and the query) follow after a pause
  const [text, setText] = useState(value)
  useEffect(() => {
    if (text.trim() === value) return
    const timer = setTimeout(() => onChange(text.trim() || null), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, value, onChange])

  return (
    <InputGroup className="h-8">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={t("wiki.search.placeholder")}
        placeholder={t("wiki.search.placeholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setText("")
            onChange(null)
          }
        }}
      />
      {text ? (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={t("wiki.search.clear")}
            onClick={() => {
              setText("")
              onChange(null)
            }}
          >
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

/** Matching pages with an excerpt; replaces the tree while a search is active. */
export function WikiSearchResults({
  groupId,
  query,
  onSelect,
}: {
  groupId: string
  query: string
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const results = useDbQuery(["wikiPage", "search", groupId, query], () =>
    api.get<Hit[]>(
      `/api/groups/${groupId}/wiki/search?q=${encodeURIComponent(query)}`
    )
  )
  if (results.isPending)
    return (
      <div className="flex flex-col gap-2 px-1">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  if (!results.data?.length)
    return (
      <p className="px-1 text-xs text-muted-foreground">
        {t("wiki.search.noMatch", { query })}
      </p>
    )
  return (
    <ul className="flex flex-col gap-0.5" aria-label={t("wiki.search.results")}>
      {results.data.map((hit) => (
        <li key={hit.id}>
          <button
            type="button"
            onClick={() => onSelect(hit.id)}
            className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
          >
            <span className="truncate text-sm font-medium">
              <Highlight text={hit.title} term={query} />
            </span>
            {hit.excerpt ? (
              <span className="line-clamp-2 text-xs text-muted-foreground">
                <Highlight text={hit.excerpt} term={query} />
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  )
}
