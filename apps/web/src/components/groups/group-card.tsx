import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { GroupWithMe } from "./group-query"
import { GroupCover, PrivacyLabel } from "./group-visuals"
import { MembershipButton } from "./membership-button"

export function GroupCard({ group }: { group: GroupWithMe }) {
  const { t } = useTranslation()
  const membership = group.members[0]
  const count = group._count.members

  return (
    <Card className="gap-0 py-0">
      <Link to={`/groups/${group.slug}`} tabIndex={-1} aria-hidden>
        <GroupCover group={group} className="h-24" />
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <Link
          to={`/groups/${group.slug}`}
          className="line-clamp-1 text-base font-semibold hover:underline"
        >
          {group.name}
        </Link>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <PrivacyLabel privacy={group.privacy} />
          <span aria-hidden>·</span>
          <span>{t("groups.memberCount", { count })}</span>
        </p>
        <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
          {group.description || t("groups.noDescription")}
        </p>
      </div>
      <div className="px-4 pb-4">
        <MembershipButton
          group={group}
          membership={membership}
          className="w-full"
          size="sm"
        />
      </div>
    </Card>
  )
}

export function GroupCardSkeleton() {
  return (
    <Card className="gap-0 py-0" aria-hidden>
      <Skeleton className="h-24 rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    </Card>
  )
}
