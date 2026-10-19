import { cn } from "cn"
import { LockIcon, MessageSquareIcon, SearchXIcon } from "lucide-react"
import { parseAsString, useQueryState } from "nuqs"
import { Link, useParams } from "react-router-dom"
import { PostComposer } from "@/components/feed/post-composer"
import { PostFeed } from "@/components/feed/post-feed"
import { GroupAbout } from "@/components/groups/group-about"
import { GroupCalendar } from "@/components/groups/group-calendar"
import {
  GroupCallButton,
  GroupLiveCallBanner,
} from "@/components/groups/group-call-bar"
import { GroupMembers } from "@/components/groups/group-members"
import { type GroupWithMe, groupInclude } from "@/components/groups/group-query"
import { GroupCover, PrivacyLabel } from "@/components/groups/group-visuals"
import { MembershipButton } from "@/components/groups/membership-button"
import { useGroupCall } from "@/components/groups/use-group-call"
import { GroupKnowledge } from "@/components/groups/wiki/group-knowledge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import type { GroupCallState } from "@/lib/realtime-events"
import { ScrollArea } from "@/components/ui/scroll-area"

const TABS = [
  "discussion",
  "chat",
  "knowledge",
  "calendar",
  "members",
  "about",
] as const
type Tab = (typeof TABS)[number]
/** tabs that need the wide content column */
const WIDE_TABS: Tab[] = ["knowledge", "calendar"]

const GroupPage = () => {
  const params = useParams()
  const { me } = useApp()
  const slug = params.groupSlug ?? ""
  const [tabParam, setTabParam] = useQueryState(
    "tab",
    parseAsString.withDefault("")
  )
  const tab: Tab = (TABS as readonly string[]).includes(tabParam)
    ? (tabParam as Tab)
    : "discussion"

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

  const isMember = group?.members[0]?.status === "ACTIVE"
  const live = useGroupCall(group?.id ?? "", Boolean(group) && isMember)

  if (isPending) return <GroupSkeleton />

  if (!group) {
    return (
      <Empty className="mx-auto mt-10 max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>Group not found</EmptyTitle>
          <EmptyDescription>
            This group doesn't exist, or it's secret and you're not a member.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to={"/groups"}>Browse groups</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const membership = group.members[0]
  const canSeePosts = isMember || group.privacy === "PUBLIC"
  const locked = (
    <Empty className="rounded-xl border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LockIcon />
        </EmptyMedia>
        <EmptyTitle>Members only</EmptyTitle>
        <EmptyDescription>
          {membership?.status === "PENDING"
            ? "Your request is waiting for an admin's approval."
            : "Join the group to take part."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <MembershipButton group={group} membership={membership} />
      </EmptyContent>
    </Empty>
  )

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="-m-4 min-h-[calc(100svh-3rem)] gap-0 bg-muted/50 md:-m-6"
    >
      <GroupHeader group={group} live={isMember ? live : null} onTab={setTab} />
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-4 p-4 md:p-6",
          WIDE_TABS.includes(tab) ? "max-w-5xl" : "max-w-2xl"
        )}
      >
        {isMember && live ? <GroupLiveCallBanner live={live} /> : null}
        <TabsContent value="discussion" className="flex flex-col gap-4">
          {canSeePosts ? (
            <>
              {isMember ? (
                <PostComposer groupId={group.id} groupName={group.name} />
              ) : null}
              <PostFeed
                scope={["group", group.id, me.id]}
                where={{ groupId: group.id }}
                pinnedFirst
                showGroup={false}
                empty={
                  <Empty className="rounded-xl border border-dashed bg-card">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <MessageSquareIcon />
                      </EmptyMedia>
                      <EmptyTitle>No posts yet</EmptyTitle>
                      <EmptyDescription>
                        {isMember
                          ? "Start the conversation with the first post."
                          : "Join the group to post here."}
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                }
              />
            </>
          ) : (
            <Empty className="rounded-xl border border-dashed bg-card">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LockIcon />
                </EmptyMedia>
                <EmptyTitle>This group is closed</EmptyTitle>
                <EmptyDescription>
                  {membership?.status === "PENDING"
                    ? "Your request is waiting for an admin's approval."
                    : "Only members can see posts. Request to join to take part."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <MembershipButton group={group} membership={membership} />
              </EmptyContent>
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="knowledge">
          {canSeePosts ? <GroupKnowledge group={group} /> : locked}
        </TabsContent>
        <TabsContent value="calendar">
          {canSeePosts ? (
            <GroupCalendar group={group} canCreate={isMember} />
          ) : (
            locked
          )}
        </TabsContent>
        <TabsContent value="members">
          <GroupMembers group={group} />
        </TabsContent>
        <TabsContent value="about">
          <GroupAbout group={group} />
        </TabsContent>
      </div>
    </Tabs>
  )
}

/** Rendered inside the page's `Tabs` root so the tab list controls the panels below. */
function GroupHeader({
  group,
  live,
  onTab,
}: {
  group: GroupWithMe
  /** null for non-members: they can't see or join the group's call */
  live: GroupCallState | null
  onTab: (tab: string) => void
}) {
  const membership = group.members[0]
  const isMember = membership?.status === "ACTIVE"
  return (
    <div className="border-b bg-card">
      <div className="mx-auto max-w-4xl">
        <GroupCover group={group} className="h-36 md:h-56 md:rounded-b-xl" />
        <div className="flex flex-col gap-4 px-4 pt-4 md:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                {group.name}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                <PrivacyLabel privacy={group.privacy} />
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => onTab("members")}
                >
                  {group._count.members} member
                  {group._count.members === 1 ? "" : "s"}
                </button>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isMember ? (
                <GroupCallButton groupId={group.id} live={live} />
              ) : null}
              <MembershipButton group={group} membership={membership} />
            </div>
          </div>
          <ScrollArea orientation="horizontal" className="-mb-0.5 max-w-full">
            <TabsList variant="line" className="justify-start">
              <TabsTrigger value="discussion" className="p-2">
                Discussion
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="p-2">
                Knowledge
              </TabsTrigger>
              <TabsTrigger value="calendar" className="p-2">
                Calendar
              </TabsTrigger>
              <TabsTrigger value="members" className="p-2">
                Members
              </TabsTrigger>
              <TabsTrigger value="about" className="p-2">
                About
              </TabsTrigger>
            </TabsList>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}

function GroupSkeleton() {
  return (
    <div className="-m-4 md:-m-6" aria-busy>
      <div className="mx-auto max-w-4xl">
        <Skeleton className="h-36 rounded-none md:h-56 md:rounded-b-xl" />
        <div className="flex flex-col gap-3 p-4 md:px-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 md:p-6">
        <Card className="h-32" />
      </div>
    </div>
  )
}

export default GroupPage
