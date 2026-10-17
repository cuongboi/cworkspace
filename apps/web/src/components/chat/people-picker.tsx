import { cn } from "cn"
import { CheckIcon, SearchIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { UserAvatar } from "@/components/common/user-avatar"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import { ScrollArea } from "@/components/ui/scroll-area"

export type PickedUser = { id: string; name: string; image: string | null }

type Props = {
  value: PickedUser[]
  onChange: (users: PickedUser[]) => void
  /** users that can't be picked (e.g. already in the conversation) */
  exclude?: string[]
  autoFocus?: boolean
}

/** Search the org's members and toggle a multi-selection, shown as removable chips. */
export function PeoplePicker({
  value,
  onChange,
  exclude = [],
  autoFocus,
}: Props) {
  const { org, me } = useOrg()
  const [q, setQ] = useState("")
  const term = q.trim()

  const { data: users = [], isPending } = useDbQuery(
    ["user", "findMany", "chat-picker", org.id, term],
    () =>
      db.user.findMany({
        where: {
          id: { not: me.id },
          members: { some: { organizationId: org.id } },
          ...(term ? { name: { contains: term, mode: "insensitive" } } : {}),
        },
        select: { id: true, name: true, image: true },
        orderBy: { name: "asc" },
        take: 30,
      }),
    { staleTime: 60_000, placeholderData: (prev) => prev }
  )

  const selected = new Set(value.map((u) => u.id))
  const excluded = new Set(exclude)
  const candidates = users.filter((u) => !excluded.has(u.id))

  const toggle = (user: PickedUser) =>
    onChange(
      selected.has(user.id)
        ? value.filter((u) => u.id !== user.id)
        : [...value, user]
    )

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="pl-8"
          autoFocus={autoFocus}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !q && value.length)
              onChange(value.slice(0, -1))
            if (e.key === "Enter" && candidates[0]) {
              e.preventDefault()
              toggle(candidates[0])
              setQ("")
            }
          }}
        />
      </div>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected people">
          {value.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => toggle(u)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-0.5 pr-2 pl-0.5 text-sm text-primary hover:bg-primary/20"
                aria-label={`Remove ${u.name}`}
              >
                <UserAvatar user={u} size="sm" />
                <span className="max-w-32 truncate">{u.name}</span>
                <XIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <ScrollArea className="-mx-2" viewportClassName="max-h-72 min-h-40">
        {isPending ? (
          <div className="flex flex-col gap-1 px-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            No people found
          </p>
        ) : (
          <ul className="flex flex-col">
            {candidates.map((u) => {
              const isSelected = selected.has(u.id)
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggle(u)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                      isSelected && "bg-accent/60"
                    )}
                  >
                    <UserAvatar user={u} presence />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {u.name}
                    </span>
                    <span
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full border",
                        isSelected &&
                          "border-primary bg-primary text-primary-foreground"
                      )}
                    >
                      {isSelected ? <CheckIcon className="size-3.5" /> : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
