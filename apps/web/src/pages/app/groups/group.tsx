import {
  EyeOffIcon,
  LockIcon,
  MessageSquareIcon,
  SearchXIcon,
} from "lucide-react"
import { parseAsString, useQueryState } from "nuqs"
import { Link, Navigate, useParams } from "react-router-dom"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { PostComposer } from "@/components/feed/post-composer"
import { canModerate } from "@/components/groups/channel-data"
import { PostFeed } from "@/components/feed/post-feed"
import { GroupAbout } from "@/components/groups/group-about"
import { GroupCalendar } from "@/components/groups/group-calendar"
import { GroupLiveCallBanner } from "@/components/groups/group-call-bar"
import {
  GROUP_TABS,
  GroupHeader,
  type GroupTab,
} from "@/components/groups/group-header"
import { GroupMembers } from "@/components/groups/group-members"
import { groupInclude } from "@/components/groups/group-query"
import { GroupSideRail } from "@/components/groups/group-side-rail"
import { MembershipButton } from "@/components/groups/membership-button"
import { useGroupCall } from "@/components/groups/use-group-call"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { rememberGroup } from "@/lib/last-group"
import { useDbQuery } from "@/lib/query"
import { ScrollArea } from "@/components/ui/scroll-area"
import { PageScrollContext } from "@/hooks/use-page-scroll"

const GroupPage = () => {
  const params = useParams()
  const { me, isAdmin } = useApp()
  const { t } = useTranslation()
  const slug = params.groupSlug ?? ""
  // the page scrolls its own viewport (bleed layout): the virtualized feed needs it as its scroll element
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const [tabParam, setTabParam] = useQueryState(
    "tab",
    parseAsString.withDefault("")
  )
  const { data: group, isPending } = useDbQuery(
    ["group", "findFirst", "slug", slug, me.id],
    () =>
      db.group.findFirst({
        where: { slug },
        include: groupInclude(me.id),
      })
  )

  const setTab = (next: string) =>
    void setTabParam(next === "discussion" ? null : next, { scroll: false })

  const tab: GroupTab =
    (GROUP_TABS as readonly string[]).includes(tabParam) &&
    (tabParam !== "calendar" || group?.calendarEnabled !== false)
      ? (tabParam as GroupTab)
      : "discussion"

  const isMember = group?.members[0]?.status === "ACTIVE"
  // mirrors the Post create policy (the server enforces it)
  const canPost =
    isMember &&
    (group?.postPolicy !== "ADMINS" ||
      canModerate(group.members[0]?.role, isAdmin))
  const live = useGroupCall(group?.id ?? "", Boolean(group) && isMember)
  useEffect(() => {
    if (isMember && group) rememberGroup(group.slug)
  }, [isMember, group])

  // the wiki used to be a tab: keep old links working
  if (tabParam === "knowledge")
    return <Navigate to={`/groups/${slug}/wiki`} replace />
  if (isPending) return <GroupSkeleton />

  if (!group) {
    return (
      <Empty className="mx-auto mt-10 max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>{t("groups.notFound")}</EmptyTitle>
          <EmptyDescription>{t("groups.notFoundBody")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to={"/groups/discover"}>{t("groups.browse")}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const membership = group.members[0]
  const canSeePosts = isMember || group.privacy === "PUBLIC"
  const joinCta =
    membership?.status === "PENDING" || group.privacy === "SECRET" ? null : (
      <EmptyContent>
        <MembershipButton group={group} membership={membership} />
      </EmptyContent>
    )
  const locked = (
    <Empty className="rounded-2xl border bg-card py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {group.privacy === "SECRET" ? <EyeOffIcon /> : <LockIcon />}
        </EmptyMedia>
        <EmptyTitle>{t("groups.membersOnly")}</EmptyTitle>
        <EmptyDescription>
          {membership?.status === "PENDING"
            ? t("groups.pendingBody")
            : group.privacy === "SECRET"
              ? t("groups.secretBody")
              : t("groups.closedBody")}
        </EmptyDescription>
      </EmptyHeader>
      {joinCta}
    </Empty>
  )

  return (
    <ScrollArea viewportRef={setViewport} className="h-full">
      <PageScrollContext value={viewport}>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="min-h-full gap-0 bg-background"
        >
          <GroupHeader group={group} tab={tab} live={isMember ? live : null} />
          <div className="mx-auto w-full max-w-5xl px-3 py-4 md:px-6 md:py-5">
            <TabsContent
              value="discussion"
              className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]"
            >
              <div className="flex min-w-0 flex-col gap-3">
                {isMember && live ? <GroupLiveCallBanner live={live} /> : null}
                {canSeePosts ? (
                  <>
                    {canPost ? (
                      <PostComposer groupId={group.id} groupName={group.name} />
                    ) : isMember ? (
                      <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                        {t("groups.features.adminsOnlyPosting")}
                      </p>
                    ) : null}
                    <PostFeed
                      scope={["group", group.id, me.id]}
                      where={{ groupId: group.id }}
                      pinnedFirst
                      showGroup={false}
                      empty={
                        <Empty className="rounded-2xl border bg-card">
                          <EmptyHeader>
                            <EmptyMedia variant="icon">
                              <MessageSquareIcon />
                            </EmptyMedia>
                            <EmptyTitle>{t("groups.noPosts")}</EmptyTitle>
                            <EmptyDescription>
                              {isMember
                                ? t("groups.noPostsMember")
                                : t("groups.noPostsGuest")}
                            </EmptyDescription>
                          </EmptyHeader>
                          {isMember ? null : joinCta}
                        </Empty>
                      }
                    />
                  </>
                ) : (
                  locked
                )}
              </div>
              <div className="hidden lg:block">
                <GroupSideRail group={group} isMember={isMember} />
              </div>
            </TabsContent>
            <TabsContent value="calendar">
              {canSeePosts ? (
                <GroupCalendar group={group} canCreate={isMember} />
              ) : (
                locked
              )}
            </TabsContent>
            <TabsContent value="members" className="mx-auto w-full">
              {canSeePosts || group.privacy === "CLOSED" ? (
                <GroupMembers group={group} />
              ) : (
                locked
              )}
            </TabsContent>
            <TabsContent
              value="about"
              className="mx-auto flex w-full flex-col gap-3"
            >
              <GroupAbout group={group} />
              {/* phones have no side column: its members and shortcuts live here */}
              <div className="lg:hidden">
                <GroupSideRail group={group} isMember={isMember} hideAbout />
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </PageScrollContext>
    </ScrollArea>
  )
}

function GroupSkeleton() {
  return (
    <div aria-busy className="h-full bg-background">
      <div className="border-b bg-card">
        <Skeleton className="h-28 rounded-none md:h-36" />
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 pb-4 md:flex-row md:items-end md:px-6">
          <Skeleton className="-mt-9 size-18 rounded-xl border-4 border-card md:-mt-10 md:size-20" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <div className="border-b bg-card">
        <div className="mx-auto flex h-11 max-w-5xl items-center gap-6 px-5 md:px-7">
          {[72, 36, 60, 64, 44].map((w) => (
            <Skeleton key={w} className="h-4" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-5 md:px-6 md:py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <Skeleton className="hidden h-56 rounded-xl lg:block" />
      </div>
    </div>
  )
}

export default GroupPage
