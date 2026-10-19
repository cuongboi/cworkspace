import { Outlet, useLocation, useParams } from "react-router-dom"
import { GroupsSidebar } from "@/components/groups/groups-sidebar"
import { useIsMobile } from "@/hooks/use-mobile"

/**
 * Groups area: the groups sidebar | the selected page (group overview, channel, discover).
 * On mobile only one pane shows: the sidebar at /groups, the page elsewhere.
 */
const GroupsLayout = () => {
  const isMobile = useIsMobile()
  const params = useParams()
  const { pathname } = useLocation()
  const atRoot = !params.groupSlug && !pathname.startsWith("/groups/discover")

  if (isMobile) {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        {atRoot ? <GroupsSidebar /> : <Outlet />}
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="w-64 shrink-0 border-r">
        <GroupsSidebar />
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}

export default GroupsLayout
