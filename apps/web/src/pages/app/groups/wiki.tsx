import { BookXIcon, LockIcon, SearchXIcon } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"
import { groupInclude } from "@/components/groups/group-query"
import { MembershipButton } from "@/components/groups/membership-button"
import { WikiWorkspace } from "@/components/groups/wiki/wiki-workspace"
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
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { rememberGroup } from "@/lib/last-group"
import { useDbQuery } from "@/lib/query"

/** /groups/:groupSlug/wiki[/:pageId] — the group's Wiki. */
const GroupWikiPage = () => {
  const params = useParams()
  const { me } = useApp()
  const { t } = useTranslation()
  const slug = params.groupSlug ?? ""
  // same key as the group page: one cached group either way
  const { data: group, isPending } = useDbQuery(
    ["group", "findFirst", "slug", slug, me.id],
    () => db.group.findFirst({ where: { slug }, include: groupInclude(me.id) })
  )
  const membership = group?.members[0]
  const isMember = membership?.status === "ACTIVE"
  useEffect(() => {
    if (isMember && group) rememberGroup(group.slug)
  }, [isMember, group])

  if (isPending) {
    return (
      <div aria-busy className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b bg-card px-4 py-2.5 md:px-6">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-11 rounded-none border-b" />
        <div className="flex-1" />
      </div>
    )
  }
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
            <Link to="/groups/discover">{t("groups.browse")}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  if (!group.wikiEnabled) {
    return (
      <Empty className="mx-auto mt-10 max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookXIcon />
          </EmptyMedia>
          <EmptyTitle>{t("groups.features.wikiOff")}</EmptyTitle>
          <EmptyDescription>{t("groups.features.offBody")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to={`/groups/${group.slug}`}>
              {t("groups.features.backToGroup")}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  // mirrors the WikiPage read policy (the server enforces it)
  const canRead = isMember || group.privacy === "PUBLIC"
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {canRead ? (
          <WikiWorkspace group={group} pageParam={params.pageId ?? null} />
        ) : (
          <Empty className="mx-auto mt-10 max-w-md rounded-xl border border-dashed bg-card py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LockIcon />
              </EmptyMedia>
              <EmptyTitle>{t("groups.membersOnly")}</EmptyTitle>
              <EmptyDescription>
                {membership?.status === "PENDING"
                  ? t("groups.pendingBody")
                  : t("groups.wikiLocked")}
              </EmptyDescription>
            </EmptyHeader>
            {membership?.status === "PENDING" ? null : (
              <EmptyContent>
                <MembershipButton group={group} membership={membership} />
              </EmptyContent>
            )}
          </Empty>
        )}
      </div>
    </div>
  )
}

export default GroupWikiPage
