import { cn } from "cn"
import { UsersRoundIcon } from "lucide-react"
import {
  type ComponentProps,
  type KeyboardEvent,
  type Ref,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { Textarea } from "@/components/ui/textarea"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { EVERYONE_ID, formatMention, MENTION_RE } from "@/lib/mentions"
import { useDbQuery } from "@/lib/query"
import { UserAvatar } from "./user-avatar"

/**
 * Textarea with @mention autocomplete over the company's members. Users see "@Name"; the value
 * reported through `onChange` is serialized with `@[Name](userId)` tokens (see `@/lib/mentions`).
 * Pass `value=""` to reset after submitting.
 */

type Props = Omit<
  ComponentProps<typeof Textarea>,
  "value" | "onChange" | "onSubmit"
> & {
  value: string
  onChange: (serialized: string) => void
  /** Enter submits (Shift+Enter for a newline) */
  onSubmit?: () => void
  /** limit suggestions to these people (e.g. a chat's members) instead of the whole company */
  people?: Person[]
  /** offer `@everyone` first (group chats) */
  everyone?: boolean
  /** imperative handle: open the suggestions as if "@" was typed (toolbar button) */
  controlRef?: Ref<MentionTextareaHandle>
}

type Person = { id: string; name: string; image: string | null }

export type MentionTextareaHandle = { openMention: () => void }

const EVERYONE: Person = { id: EVERYONE_ID, name: "everyone", image: null }

type Mention = { name: string; userId: string }

function deserialize(value: string): { display: string; mentions: Mention[] } {
  const mentions: Mention[] = []
  const display = value.replace(
    MENTION_RE,
    (_, name: string, userId: string) => {
      mentions.push({ name, userId })
      return `@${name}`
    }
  )
  return { display, mentions }
}

function serialize(display: string, mentions: Mention[]) {
  let out = display
  // longest names first so "@Ann Lee" wins over "@Ann"
  for (const m of [...mentions].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${m.name}`).join(formatMention(m.name, m.userId))
  }
  return out
}

export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  className,
  onKeyDown,
  people,
  everyone = false,
  controlRef,
  ...props
}: Props) {
  const { me } = useApp()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [state, setState] = useState(() => ({
    ...deserialize(value),
    serialized: value,
  }))
  const [query, setQuery] = useState<{ text: string; start: number } | null>(
    null
  )
  const [highlight, setHighlight] = useState(0)

  // external reset / replace (e.g. cleared after submit, or editing another item)
  if (value !== state.serialized)
    setState({ ...deserialize(value), serialized: value })

  const { data: companyPeople = [] } = useDbQuery(
    ["user", "findMany", "mention", query?.text],
    () =>
      db.user.findMany({
        where: {
          id: { not: me.id },
          ...(query?.text
            ? { name: { contains: query.text, mode: "insensitive" } }
            : {}),
        },
        select: { id: true, name: true, image: true },
        orderBy: { name: "asc" },
        take: 6,
      }),
    { enabled: query !== null && !people, staleTime: 60_000 }
  )
  const term = query?.text.toLowerCase() ?? ""
  const candidates: Person[] = people
    ? [
        ...(everyone && "everyone".startsWith(term) ? [EVERYONE] : []),
        ...people
          .filter((p) => p.id !== me.id && p.name.toLowerCase().includes(term))
          .slice(0, 8),
      ]
    : companyPeople

  const update = (display: string, mentions: Mention[]) => {
    const kept = mentions.filter((m) => display.includes(`@${m.name}`))
    const serialized = serialize(display, kept)
    setState({ display, mentions: kept, serialized })
    onChange(serialized)
  }

  useImperativeHandle(controlRef, () => ({
    openMention: () => {
      const el = ref.current
      const caret = el?.selectionStart ?? state.display.length
      const before = state.display.slice(0, caret)
      const prefix = before && !/\s$/.test(before) ? " @" : "@"
      const display = `${before}${prefix}${state.display.slice(caret)}`
      update(display, state.mentions)
      const pos = caret + prefix.length
      setQuery({ text: "", start: pos - 1 })
      setHighlight(0)
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(pos, pos)
      })
    },
  }))

  const detectQuery = (text: string, caret: number) => {
    const before = text.slice(0, caret)
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(before)
    setQuery(
      match
        ? { text: match[2] ?? "", start: caret - (match[2]?.length ?? 0) - 1 }
        : null
    )
    setHighlight(0)
  }

  const pick = (user: { id: string; name: string }) => {
    if (!query) return
    const el = ref.current
    const caret = el?.selectionStart ?? state.display.length
    const name = user.name.replace(/[[\]]/g, "")
    const display = `${state.display.slice(0, query.start)}@${name} ${state.display.slice(caret)}`
    update(display, [
      ...state.mentions.filter((m) => m.name !== name),
      { name, userId: user.id },
    ])
    setQuery(null)
    const pos = query.start + name.length + 2
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query && candidates.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const delta = e.key === "ArrowDown" ? 1 : -1
        setHighlight((h) => (h + delta + candidates.length) % candidates.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        const user = candidates[highlight]
        if (user) pick(user)
        return
      }
      if (e.key === "Escape") {
        setQuery(null)
        return
      }
    }
    if (
      onSubmit &&
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault()
      onSubmit()
      return
    }
    onKeyDown?.(e)
  }

  return (
    <div className="relative w-full">
      <Textarea
        ref={ref}
        value={state.display}
        onChange={(e) => {
          update(e.target.value, state.mentions)
          detectQuery(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        className={cn("resize-none", className)}
        {...props}
      />
      {query && candidates.length > 0 ? (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-1 w-64 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {candidates.map((user, i) => (
            <button
              key={user.id}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(user)
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                i === highlight
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/60"
              )}
            >
              {user.id === EVERYONE_ID ? (
                <>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UsersRoundIcon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    Everyone
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      Notify all members
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <UserAvatar user={user} size="sm" />
                  <span className="truncate">{user.name}</span>
                </>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
