import { PlusIcon, SearchIcon, UsersIcon } from "lucide-react"
import { useQueryState } from "nuqs"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { useState } from "react"
import { CreateGroupDialog } from "@/components/groups/create-group-dialog"
import { GroupCard, GroupCardSkeleton } from "@/components/groups/group-card"
import { groupInclude } from "@/components/groups/group-query"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import { COMPANY_NAME } from "@/lib/company"

type Tab = "discover" | "mine"

const GroupsPage = () => {
  const { t } = useTranslation()
  const { me } = useApp()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(
    searchParams.get("tab") === "mine" ? "mine" : "discover"
  )
  const [q, setQ] = useState("")
  const [create, setCreate] = useQueryState("create")
  const createOpen = create === "1"
  const setCreateOpen = (open: boolean) => void setCreate(open ? "1" : null)

  const { data: groups, isPending } = useDbQuery(
    ["group", "findMany", "directory", me.id],
    () =>
      db.group.findMany({
        include: groupInclude(me.id),
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        take: 100,
      })
  )

  const needle = q.trim().toLowerCase()
  const visible = (groups ?? []).filter((g) => {
    if (tab === "mine" && g.members[0]?.status !== "ACTIVE") return false
    if (!needle) return true
    return (
      g.name.toLowerCase().includes(needle) ||
      g.description?.toLowerCase().includes(needle)
    )
  })
  const myCount = (groups ?? []).filter(
    (g) => g.members[0]?.status === "ACTIVE"
  ).length

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("groups.directory.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("groups.directory.subtitle", { company: COMPANY_NAME })}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            {t("groups.create.submit")}
          </Button>
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="discover">
                {t("groups.directory.discover")}
              </TabsTrigger>
              <TabsTrigger value="mine">
                {t("groups.directory.mine")}
                {groups ? ` (${myCount})` : ""}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative sm:w-72">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("groups.directory.search")}
              aria-label={t("groups.directory.search")}
              className="pl-8"
            />
          </div>
        </div>

        {isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <GroupCardSkeleton key={i} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>
                {needle
                  ? t("groups.directory.noMatch")
                  : t("groups.directory.empty")}
              </EmptyTitle>
              <EmptyDescription>
                {tab === "mine"
                  ? t("groups.directory.emptyMine")
                  : t("groups.directory.emptyBody")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setCreateOpen(true)}>
                <PlusIcon />
                {t("groups.create.submit")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((g) => (
              <GroupCard key={g.id} group={g} />
            ))}
          </div>
        )}

        <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    </ScrollArea>
  )
}

export default GroupsPage
