import { cn } from "cn"
import {
  ChevronLeftIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  UsersIcon,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { GroupCallState } from "@/lib/realtime-events"
import { EditGroupDialog, useCanAdminGroup } from "./group-about"
import { GroupCallButton } from "./group-call-bar"
import { ChannelFormDialog } from "./channel-form-dialog"
import type { GroupWithMe } from "./group-query"
import { GroupAvatar, GroupCover, PrivacyBadge } from "./group-visuals"
import { MembershipButton } from "./membership-button"

export const GROUP_TABS = [
  "discussion",
  "calendar",
  "members",
  "about",
] as const
export type GroupTab = (typeof GROUP_TABS)[number]

export function groupTabHref(slug: string, tab: GroupTab) {
  return tab === "discussion" ? `/groups/${slug}` : `/groups/${slug}?tab=${tab}`
}

/**
 * Group identity + actions + tab bar, shared by the group page and the wiki so both keep the
 * group's context. Information-first: a slim banner, then one row with avatar, name, privacy,
 * member count and actions. On phones the primary action gets its own full-width row so it's
 * easy to hit with a thumb. `compact` drops the banner (the wiki needs the height).
 */
export function GroupHeader({
  group,
  tab,
  live,
  compact = false,
}: {
  group: GroupWithMe
  /** null when the page isn't one of the tabs (the wiki) */
  tab: GroupTab | null
  /** null for non-members: they can't see or join the group's call */
  live: GroupCallState | null
  compact?: boolean
}) {
  const { t } = useTranslation()
  const membership = group.members[0]
  const isMember = membership?.status === "ACTIVE"
  const count = group._count.members

  return (
    <>
      <header className="border-b bg-card">
        {compact ? null : (
          <GroupCover
            group={group}
            className={cn("h-20 md:h-24", group.coverUrl && "h-28 md:h-36")}
          />
        )}
        <div className="mx-auto w-full max-w-5xl px-3 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <BackToGroups />
            <GroupAvatar
              group={group}
              className={cn(
                "size-12 text-lg",
                compact ? "size-10 text-base" : "md:size-14 md:text-xl"
              )}
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg leading-snug font-bold md:text-xl">
                {group.name}
              </h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                <PrivacyBadge privacy={group.privacy} />
                <Link
                  to={groupTabHref(group.slug, "members")}
                  className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                >
                  <UsersIcon className="size-3.5" aria-hidden />
                  {t("groups.memberCount", { count })}
                </Link>
              </p>
            </div>
            {/* desktop: actions inline; phones keep only the overflow menu here */}
            <div className="hidden shrink-0 items-center gap-2 md:flex">
              {isMember && !live?.call ? (
                <GroupCallButton groupId={group.id} live={live} />
              ) : null}
              <MembershipButton group={group} membership={membership} />
              <GroupOverflowMenu group={group} />
            </div>
            <div className="md:hidden">
              <GroupOverflowMenu group={group} />
            </div>
          </div>
          {compact ? null : (
            <div className="mt-3 flex gap-2 md:hidden [&>*]:flex-1">
              <MembershipButton
                group={group}
                membership={membership}
                className="w-full"
              />
              {isMember && !live?.call ? (
                <GroupCallButton groupId={group.id} live={live} />
              ) : null}
            </div>
          )}
        </div>
      </header>
      <GroupTabBar
        slug={group.slug}
        tabs={GROUP_TABS.filter(
          (tab) => tab !== "calendar" || group.calendarEnabled
        )}
        active={tab}
        sticky={!compact}
      />
    </>
  )
}

function BackToGroups() {
  const { t } = useTranslation()
  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      className="-ml-1 shrink-0 md:hidden"
    >
      <Link to="/groups" aria-label={t("groups.allGroups")}>
        <ChevronLeftIcon className="size-5" />
      </Link>
    </Button>
  )
}

/** Pill tabs, sticky under the page top while the group scrolls; scroll sideways on phones. */
function GroupTabBar({
  slug,
  tabs,
  active,
  sticky,
}: {
  slug: string
  tabs: readonly GroupTab[]
  active: GroupTab | null
  sticky: boolean
}) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t("groups.sections")}
      className={cn(
        "z-20 border-b bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/80",
        sticky && "sticky top-0"
      )}
    >
      <ScrollArea orientation="horizontal" className="mx-auto w-full max-w-5xl">
        <ul className="flex items-center gap-1.5 px-3 py-2 md:px-6">
          {tabs.map((tab) => {
            const current = tab === active
            return (
              <li key={tab}>
                <Link
                  to={groupTabHref(slug, tab)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted max-md:h-10 max-md:px-4 max-md:text-sm",
                    current &&
                      "bg-brand-subtle text-brand hover:bg-brand-subtle hover:text-brand"
                  )}
                >
                  {t(`groups.tabs.${tab}`)}
                </Link>
              </li>
            )
          })}
        </ul>
      </ScrollArea>
    </nav>
  )
}

function GroupOverflowMenu({ group }: { group: GroupWithMe }) {
  const { t } = useTranslation()
  const canAdmin = useCanAdminGroup(group)
  const [editing, setEditing] = useState(false)
  // dialogs live outside the menu: it unmounts its items when it closes
  const [creatingChannel, setCreatingChannel] = useState(false)
  const { pathname } = useLocation()

  const copyLink = () => {
    const url = new URL(pathname, window.location.origin).toString()
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t("common.linkCopied")))
      .catch(() => toast.error(t("common.copyFailed")))
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("groups.moreActions")}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-52 [&_[role=menuitem]]:max-md:min-h-11"
        >
          <DropdownMenuItem onSelect={copyLink}>
            <LinkIcon />
            {t("common.copyLink")}
          </DropdownMenuItem>
          {canAdmin ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <PencilIcon />
                {t("groups.editGroup")}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to={groupTabHref(group.slug, "members")}>
                  <UsersIcon />
                  {t("groups.manageMembers")}
                </Link>
              </DropdownMenuItem>
              {group.channelsEnabled ? (
                <DropdownMenuItem onSelect={() => setCreatingChannel(true)}>
                  <PlusIcon />
                  {t("groups.newChannel")}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canAdmin && editing ? (
        <EditGroupDialog group={group} open onOpenChange={setEditing} />
      ) : null}
      {canAdmin && group.channelsEnabled ? (
        <ChannelFormDialog
          groupId={group.id}
          groupSlug={group.slug}
          open={creatingChannel}
          onOpenChange={setCreatingChannel}
        />
      ) : null}
    </>
  )
}
