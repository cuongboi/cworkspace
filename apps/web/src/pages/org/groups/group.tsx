import { LockIcon, MessageSquareIcon, SearchXIcon } from "lucide-react"
import { parseAsString, useQueryState } from "nuqs"
import { Link, useParams } from "react-router-dom"
import { PostComposer } from "@/components/feed/post-composer"
import { PostFeed } from "@/components/feed/post-feed"
import { GroupAbout } from "@/components/groups/group-about"
import { GroupMembers } from "@/components/groups/group-members"
import { type GroupWithMe, groupInclude } from "@/components/groups/group-query"
import { GroupCover, PrivacyLabel } from "@/components/groups/group-visuals"
import { MembershipButton } from "@/components/groups/membership-button"
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
import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"

const TABS = ["discussion", "members", "about"] as const
type Tab = (typeof TABS)[number]

const GroupPage = () => {
  const params = useParams()
  const { org, me, href } = useOrg()
  const slug = params.groupSlug ?? ""
  const [tabParam, setTabParam] = useQueryState(
    "tab",
    parseAsString.withDefault("")
  )
  const tab: Tab = (TABS as readonly string[]).includes(tabParam)
    ? (tabParam as Tab)
    : "discussion"

  const { data: group, isPending } = useDbQuery(
    ["group", "findFirst", "slug", org.id, slug, me.id],
    () =>
      db.group.findFirst({
        where: { organizationId: org.id, slug },
        include: groupInclude(me.id),
      })
  )

  const setTab = (next: string) =>
    void setTabParam(next === "discussion" ? null : next, { scroll: false })

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
            <Link to={href("/groups")}>Browse groups</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const membership = group.members[0]
  const isMember = membership?.status === "ACTIVE"
  const canSeePosts = isMember || group.privacy === "PUBLIC"

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="-m-4 min-h-[calc(100svh-3.5rem)] gap-0 bg-muted/50 md:-m-6"
    >
      <GroupHeader group={group} onTab={setTab} />
      <div className="mx-auto w-full max-w-2xl p-4 md:p-6">
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
  onTab,
}: {
  group: GroupWithMe
  onTab: (tab: string) => void
}) {
  const membership = group.members[0]
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
            <MembershipButton group={group} membership={membership} />
          </div>
          <TabsList variant="line" className="-mb-px">
            <TabsTrigger value="discussion">Discussion</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
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
