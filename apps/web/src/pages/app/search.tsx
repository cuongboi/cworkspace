import { FileTextIcon, SearchIcon, UserIcon, UsersIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { type FormEvent, type ReactNode, useState } from "react"
import { UserAvatar } from "@/components/common/user-avatar"
import { FeedShell } from "@/components/feed/feed-shell"
import { PostCard, PostSkeleton } from "@/components/feed/post-card"
import { findPosts } from "@/components/feed/post-query"
import { groupInclude } from "@/components/groups/group-query"
import { GroupCover, PrivacyLabel } from "@/components/groups/group-visuals"
import { MembershipButton } from "@/components/groups/membership-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"

const SearchPage = () => {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const q = (searchParams.get("q") ?? "").trim()

  return (
    <FeedShell>
      <SearchBox key={q} initial={q} />
      {q ? (
        <>
          <h1 className="text-lg font-semibold">
            {t("shell.searchPage.resultsFor", { q })}
          </h1>
          <PeopleResults q={q} />
          <GroupResults q={q} />
          <PostResults q={q} />
        </>
      ) : (
        <Empty className="rounded-xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>{t("shell.searchPage.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("shell.searchPage.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </FeedShell>
  )
}

function SearchBox({ initial }: { initial: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [value, setValue] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next = value.trim()
    void navigate(next ? `/search?q=${encodeURIComponent(next)}` : "/search")
  }
  return (
    <search>
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("shell.searchPage.placeholder")}
            aria-label={t("common.search")}
            className="h-10 bg-card pl-9"
            autoFocus={!initial}
          />
        </div>
        <Button type="submit" size="lg">
          {t("common.search")}
        </Button>
      </form>
    </search>
  )
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon}
          {title}
          {count !== undefined ? (
            <span className="font-normal text-muted-foreground">· {count}</span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2">{children}</CardContent>
    </Card>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-2 py-1">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      ))}
    </div>
  )
}

function NoResults({ children }: { children: ReactNode }) {
  return <p className="px-2 py-2 text-sm text-muted-foreground">{children}</p>
}

function PeopleResults({ q }: { q: string }) {
  const { t } = useTranslation()
  const { data, isPending } = useDbQuery(
    ["user", "findMany", "search", q],
    () =>
      db.user.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
            { department: { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          name: true,
          image: true,
          title: true,
          department: true,
        },
        orderBy: { name: "asc" },
        take: 10,
      })
  )
  return (
    <Section
      icon={<UserIcon />}
      title={t("shell.search.tabs.user")}
      count={data?.length}
    >
      {isPending ? (
        <ListSkeleton />
      ) : !data?.length ? (
        <NoResults>{t("shell.searchPage.noPeople")}</NoResults>
      ) : (
        <ItemGroup>
          {data.map((p) => (
            <Item key={p.id} size="sm" asChild>
              <Link to={`/people/${p.id}`}>
                <ItemMedia>
                  <UserAvatar user={p} presence />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{p.name}</ItemTitle>
                  {p.title || p.department ? (
                    <ItemDescription>
                      {[p.title, p.department].filter(Boolean).join(" · ")}
                    </ItemDescription>
                  ) : null}
                </ItemContent>
              </Link>
            </Item>
          ))}
        </ItemGroup>
      )}
    </Section>
  )
}

function GroupResults({ q }: { q: string }) {
  const { t } = useTranslation()
  const { me } = useApp()
  const { data, isPending } = useDbQuery(
    ["group", "findMany", "search", q, me.id],
    () =>
      db.group.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        include: groupInclude(me.id),
        orderBy: { name: "asc" },
        take: 10,
      })
  )
  return (
    <Section
      icon={<UsersIcon />}
      title={t("shell.search.tabs.group")}
      count={data?.length}
    >
      {isPending ? (
        <ListSkeleton />
      ) : !data?.length ? (
        <NoResults>{t("shell.searchPage.noGroups")}</NoResults>
      ) : (
        <ItemGroup>
          {data.map((g) => (
            <Item key={g.id} size="sm">
              <ItemMedia variant="image">
                <GroupCover
                  group={g}
                  className="size-full [&_span]:text-base"
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  <Link to={`/groups/${g.slug}`} className="hover:underline">
                    {g.name}
                  </Link>
                </ItemTitle>
                <ItemDescription className="flex flex-wrap items-center gap-x-1.5">
                  <PrivacyLabel privacy={g.privacy} />
                  <span aria-hidden>·</span>
                  {t("groups.memberCount", { count: g._count.members })}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <MembershipButton
                  group={g}
                  membership={g.members[0]}
                  size="sm"
                />
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      )}
    </Section>
  )
}

function PostResults({ q }: { q: string }) {
  const { t } = useTranslation()
  const { me } = useApp()
  const { data, isPending } = useDbQuery(
    ["post", "findMany", "search", q, me.id],
    () =>
      findPosts(me.id, {
        where: {
          content: { contains: q, mode: "insensitive" },
        },
        take: 20,
      })
  )
  return (
    <section className="flex flex-col gap-4" aria-labelledby="search-posts">
      <h2 id="search-posts" className="flex items-center gap-2 font-semibold">
        <FileTextIcon className="size-4 text-muted-foreground" />
        {t("shell.search.tabs.post")}
        {data ? (
          <span className="font-normal text-muted-foreground">
            · {data.length}
          </span>
        ) : null}
      </h2>
      {isPending ? (
        <PostSkeleton />
      ) : !data?.length ? (
        <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          {t("shell.searchPage.noPosts")}
        </p>
      ) : (
        data.map((post) => <PostCard key={post.id} post={post} />)
      )}
    </section>
  )
}

export default SearchPage
