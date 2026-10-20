import { BookOpenIcon, ChevronRightIcon, HashIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { RichText } from "@/components/common/rich-text"
import { UserAvatar } from "@/components/common/user-avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import { channelsKey, channelTree, fetchChannels } from "./channel-data"
import { groupTabHref } from "./group-header"
import type { GroupWithMe } from "./group-query"
import { PrivacyLabel } from "./group-visuals"

const MEMBER_PREVIEW = 5

/** Discussion tab's right column on desktop: what the group is, who's in it, where to go next. */
export function GroupSideRail({
  group,
  isMember,
  hideAbout = false,
}: {
  group: GroupWithMe
  isMember: boolean
  hideAbout?: boolean
}) {
  const { t } = useTranslation()
  const canSeeMembers = isMember || group.privacy !== "SECRET"
  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-16">
      {hideAbout ? null : (
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t("groups.about")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {group.description ? (
              <RichText
                text={group.description}
                className="text-sm text-muted-foreground"
              />
            ) : null}
            <div className="flex flex-col gap-0.5 text-sm">
              <PrivacyLabel privacy={group.privacy} className="font-medium" />
              <span className="pl-4.5 text-xs text-muted-foreground">
                {t(`groups.privacyDescription.${group.privacy}`)}
              </span>
            </div>
            <RailLink to={groupTabHref(group.slug, "about")}>
              {t("groups.seeInfo")}
            </RailLink>
          </CardContent>
        </Card>
      )}
      {canSeeMembers ? <MembersPreview group={group} /> : null}
      {isMember ? <Shortcuts group={group} /> : null}
    </aside>
  )
}

function MembersPreview({ group }: { group: GroupWithMe }) {
  const { data: rows = [] } = useDbQuery(
    ["groupMember", "findMany", "preview", group.id],
    () =>
      db.groupMember.findMany({
        where: { groupId: group.id, status: "ACTIVE" },
        include: {
          user: { select: { id: true, name: true, image: true, title: true } },
        },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        take: MEMBER_PREVIEW,
      })
  )
  const { t } = useTranslation()
  const count = group._count.members
  if (rows.length === 0) return null
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          {t("groups.membersCard")}{" "}
          <span className="font-normal text-muted-foreground">{count}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <ul className="-mx-2 flex flex-col">
          {rows.map((r) => (
            <li key={r.user.id}>
              <Link
                to={`/people/${r.user.id}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted"
              >
                <UserAvatar user={r.user} size="sm" className="rounded-full" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {r.user.name}
                  </span>
                  {r.user.title ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.user.title}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <RailLink to={groupTabHref(group.slug, "members")}>
          {t("common.seeAll")}
        </RailLink>
      </CardContent>
    </Card>
  )
}

function Shortcuts({ group }: { group: GroupWithMe }) {
  const { data = [] } = useDbQuery(
    channelsKey(group.id),
    () => fetchChannels(group.id),
    { enabled: group.channelsEnabled }
  )
  const { t } = useTranslation()
  const channels = group.channelsEnabled ? channelTree(data).slice(0, 5) : []
  if (!group.wikiEnabled && channels.length === 0) return null
  return (
    <Card size="sm" className="gap-1 py-2">
      <ul className="flex flex-col px-2">
        {group.wikiEnabled ? (
          <li>
            <ShortcutRow to={`/groups/${group.slug}/wiki`}>
              <BookOpenIcon className="size-4 text-muted-foreground" />
              {t("groups.tabs.wiki")}
            </ShortcutRow>
          </li>
        ) : null}
        {channels.map((c) => (
          <li key={c.id}>
            <ShortcutRow to={`/groups/${group.slug}/c/${c.id}`}>
              <HashIcon className="size-4 text-muted-foreground" />
              <span className="truncate">{c.name}</span>
            </ShortcutRow>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ShortcutRow({
  to,
  children,
}: {
  to: string
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className="flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm font-medium hover:bg-muted"
    >
      {children}
    </Link>
  )
}

function RailLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-0.5 self-start text-sm font-medium text-brand hover:underline"
    >
      {children}
      <ChevronRightIcon className="size-3.5" />
    </Link>
  )
}
