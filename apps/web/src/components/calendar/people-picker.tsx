import { UserPlusIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"

export type PickedUser = { id: string; name: string; image: string | null }

type Props = {
  value: PickedUser[]
  onChange: (users: PickedUser[]) => void
  /** users that can't be picked or removed (e.g. the organizer) */
  excludeIds?: string[]
}

/** Multi-select over the company's members, searched by name. */
export function PeoplePicker({ value, onChange, excludeIds = [] }: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const query = q.trim()

  const { data: people = [], isFetching } = useDbQuery(
    ["user", "findMany", "people-picker", query],
    () =>
      db.user.findMany({
        where: {
          ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
        },
        select: { id: true, name: true, image: true, title: true },
        orderBy: { name: "asc" },
        take: 20,
      }),
    { enabled: open, staleTime: 60_000, placeholderData: (prev) => prev }
  )

  const selected = new Set(value.map((u) => u.id))
  const toggle = (user: PickedUser) => {
    onChange(
      selected.has(user.id)
        ? value.filter((u) => u.id !== user.id)
        : [...value, user]
    )
  }
  const candidates = people.filter((p) => !excludeIds.includes(p.id))

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Invited people">
          {value.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pr-1 pl-0.5 text-sm"
            >
              <UserAvatar
                user={u}
                size="sm"
                className="[&_[data-slot=avatar]]:size-5"
              />
              <span className="max-w-32 truncate">{u.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-full"
                onClick={() => toggle(u)}
                aria-label={`Remove ${u.name}`}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-fit">
            <UserPlusIcon />
            Add people
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search people…"
              value={q}
              onValueChange={setQ}
            />
            <CommandList>
              {isFetching && candidates.length === 0 ? (
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              ) : (
                <CommandEmpty>No people found.</CommandEmpty>
              )}
              <CommandGroup>
                {candidates.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={p.id}
                    data-checked={selected.has(p.id)}
                    onSelect={() => toggle(p)}
                  >
                    <UserAvatar user={p} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{p.name}</span>
                      {p.title ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {p.title}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
