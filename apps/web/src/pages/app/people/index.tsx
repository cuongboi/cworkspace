import { SearchIcon, UsersIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { PersonCard, PersonCardSkeleton } from "@/components/people/person-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import { COMPANY_NAME } from "@/lib/company"

/** Org directory: search by name, title or department. */
const PeoplePage = () => {
  const [input, setInput] = useState("")
  const [q, setQ] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250)
    return () => clearTimeout(t)
  }, [input])

  const {
    data: people,
    isPending,
    isPlaceholderData,
  } = useDbQuery(
    ["user", "findMany", "directory", q],
    () =>
      db.user.findMany({
        where: {
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { title: { contains: q, mode: "insensitive" } },
                  { department: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          image: true,
          title: true,
          department: true,
        },
        orderBy: { name: "asc" },
        take: 100,
      }),
    { placeholderData: (prev) => prev }
  )

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">People</h1>
          <p className="text-sm text-muted-foreground">
            Everyone at {COMPANY_NAME}.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search by name, title or department"
            aria-label="Search people"
            className="pl-8"
          />
        </div>
      </div>

      {isPending ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <PersonCardSkeleton key={i} />
          ))}
        </div>
      ) : (people ?? []).length === 0 ? (
        <Empty className="rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>No one found</EmptyTitle>
            <EmptyDescription>
              {q
                ? `Nobody matches "${q}". Try another name, title or department.`
                : "Invite your team to get started."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          className="grid grid-cols-2 gap-4 transition-opacity data-[stale=true]:opacity-60 md:grid-cols-3 lg:grid-cols-4"
          data-stale={isPlaceholderData}
        >
          {(people ?? []).map((p) => (
            <PersonCard key={p.id} person={p} />
          ))}
        </div>
      )}
    </div>
  )
}

export default PeoplePage
