import { cn } from "cn"
import {
  ChevronRightIcon,
  CompassIcon,
  HashIcon,
  LayoutGridIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { useState } from "react"
import {
  SidebarSection,
  sidebarRowClass,
  usePersistedOpen,
} from "@/components/common/sidebar-list"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useApp } from "@/hooks/use-app"
import { accentFor } from "@/lib/accent"
import { useDbQuery } from "@/lib/query"
import {
  type ChannelItem,
  canModerate,
  channelsKey,
  channelTree,
  fetchChannels,
  fetchMyGroups,
  isChannelUnread,
  type MyGroup,
  myGroupsKey,
} from "./channel-data"
import { ChannelFormDialog } from "./channel-form-dialog"
import { CreateGroupDialog } from "./create-group-dialog"

const EXPANDED_KEY = "groups:sidebar:expanded"

/** Groups sidebar: my groups, each expandable into its channel tree. */
export function GroupsSidebar() {
  const { me } = useApp()
  const [q, setQ] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const { data, isPending, error } = useDbQuery(myGroupsKey(me.id), () =>
    fetchMyGroups(me.id)
  )
  const term = q.trim().toLowerCase()
  const groups = (data ?? []).filter(
    (m) => !term || m.group.name.toLowerCase().includes(term)
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/40">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <h1 className="text-sm font-semibold">Groups</h1>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="ghost" size="icon-sm">
                <Link to="/groups/discover" aria-label="Discover groups">
                  <CompassIcon />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Discover groups</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Create group"
                onClick={() => setCreateOpen(true)}
              >
                <PlusIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Create group</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-2 py-3">
          <div className="relative px-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQ("")}
              placeholder="Search groups"
              aria-label="Search groups"
              className="h-8 bg-card pl-7 text-xs shadow-none md:text-xs"
            />
          </div>

          {isPending ? (
            <div className="flex flex-col gap-2 px-2" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="size-5 rounded-md" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : error ? (
            <p className="px-3 py-6 text-center text-xs text-destructive">
              Could not load your groups.
            </p>
          ) : (
            <SidebarSection
              id="mine"
              storageKey="groups:sidebar:collapsed"
              label="Your groups"
              empty={term ? "No groups match" : "You haven't joined any group"}
            >
              {groups.map((m) => (
                <GroupBranch key={m.group.id} membership={m} />
              ))}
            </SidebarSection>
          )}
        </div>
      </ScrollArea>
      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

function GroupBranch({ membership }: { membership: MyGroup }) {
  const { isAdmin } = useApp()
  const params = useParams()
  const { group } = membership
  const active = params.groupSlug === group.slug
  const [open, setOpen] = usePersistedOpen(EXPANDED_KEY, group.id, false)
  // the group being viewed always shows its channels
  const expanded = open || active
  const moderator = canModerate(membership.role, isAdmin)

  return (
    <div className="flex flex-col gap-px">
      <div
        className={cn(
          "group/branch relative flex items-center rounded-md",
          active && !params.channelId && "bg-accent"
        )}
      >
        <button
          type="button"
          aria-label={
            expanded ? `Collapse ${group.name}` : `Expand ${group.name}`
          }
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRightIcon
            className={cn(
              "size-3 transition-transform",
              expanded && "rotate-90"
            )}
          />
        </button>
        <Link
          to={`/groups/${group.slug}`}
          aria-current={active && !params.channelId ? "page" : undefined}
          className={cn(
            sidebarRowClass,
            "-ml-1 min-w-0 flex-1 pl-1 hover:bg-transparent"
          )}
        >
          <GroupMark group={group} />
          <span className={cn("truncate", active && "font-semibold")}>
            {group.name}
          </span>
        </Link>
        {moderator ? (
          <ChannelFormDialog groupId={group.id} groupSlug={group.slug}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`New channel in ${group.name}`}
              className="mr-1 text-muted-foreground opacity-0 group-hover/branch:opacity-100 focus-visible:opacity-100"
            >
              <PlusIcon />
            </Button>
          </ChannelFormDialog>
        ) : null}
      </div>
      {expanded ? <ChannelList groupId={group.id} slug={group.slug} /> : null}
    </div>
  )
}

function ChannelList({ groupId, slug }: { groupId: string; slug: string }) {
  const params = useParams()
  const { data, isPending } = useDbQuery(channelsKey(groupId), () =>
    fetchChannels(groupId)
  )
  if (isPending) {
    return (
      <div className="flex flex-col gap-2 py-1 pl-9" aria-hidden="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    )
  }
  const tree = channelTree(data ?? [])
  return (
    <ul className="flex flex-col gap-px">
      <li>
        <Link
          to={`/groups/${slug}`}
          className={cn(
            sidebarRowClass,
            "pl-9 text-muted-foreground",
            params.groupSlug === slug && !params.channelId && "text-foreground"
          )}
        >
          <LayoutGridIcon className="size-3.5" />
          <span className="truncate">Overview</span>
        </Link>
      </li>
      {tree.map((c) => (
        <li key={c.id}>
          <ChannelRow
            channel={c}
            slug={slug}
            depth={0}
            activeId={params.channelId}
          />
          {c.children.length ? (
            <ul className="flex flex-col gap-px">
              {c.children.map((child) => (
                <li key={child.id}>
                  <ChannelRow
                    channel={child}
                    slug={slug}
                    depth={1}
                    activeId={params.channelId}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function ChannelRow({
  channel,
  slug,
  depth,
  activeId,
}: {
  channel: ChannelItem
  slug: string
  depth: 0 | 1
  activeId?: string
}) {
  const active = channel.id === activeId
  const unread = isChannelUnread(channel) && !active
  return (
    <Link
      to={`/groups/${slug}/c/${channel.id}`}
      aria-current={active ? "page" : undefined}
      title={channel.topic ?? undefined}
      className={cn(
        sidebarRowClass,
        depth ? "pl-14" : "pl-9",
        active && "bg-accent",
        !active && !unread && "text-muted-foreground"
      )}
    >
      <HashIcon className="size-3.5 shrink-0 opacity-70" />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          unread && "font-semibold text-foreground"
        )}
      >
        {channel.name}
      </span>
      {unread ? (
        <span
          role="img"
          aria-label="Unread"
          className="size-1.5 shrink-0 rounded-full bg-primary"
        />
      ) : null}
    </Link>
  )
}

function GroupMark({
  group,
}: {
  group: { id: string; name: string; coverUrl: string | null }
}) {
  return group.coverUrl ? (
    <img
      src={group.coverUrl}
      alt=""
      className="size-5 shrink-0 rounded-md object-cover"
    />
  ) : (
    <span
      aria-hidden="true"
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white"
      style={{ backgroundColor: accentFor(group.id) }}
    >
      {group.name[0]?.toUpperCase()}
    </span>
  )
}
