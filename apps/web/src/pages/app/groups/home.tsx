import { Navigate } from "react-router-dom"
import { PageTitle } from "@/components/common/page-title"
import { fetchMyGroups, myGroupsKey } from "@/components/groups/channel-data"
import { Spinner } from "@/components/ui/spinner"
import { useApp } from "@/hooks/use-app"
import { useIsMobile } from "@/hooks/use-mobile"
import { useDbQuery } from "@/lib/query"
import { lastGroupSlug } from "@/lib/last-group"

/** /groups: reopen the last visited group, else the company-wide group (desktop). */
const GroupsHome = () => {
  const { me } = useApp()
  const isMobile = useIsMobile()
  const { data, isPending } = useDbQuery(myGroupsKey(me.id), () =>
    fetchMyGroups(me.id)
  )
  // mobile: the layout shows the sidebar here
  if (isMobile) return <PageTitle title="Groups" />
  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  const last = lastGroupSlug()
  const target =
    data?.find((m) => m.group.slug === last)?.group ??
    data?.find((m) => m.group.isDefault)?.group ??
    data?.[0]?.group
  return (
    <Navigate
      to={target ? `/groups/${target.slug}` : "/groups/discover"}
      replace
    />
  )
}

export default GroupsHome
