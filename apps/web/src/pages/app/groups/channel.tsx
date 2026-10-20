import { HashIcon, SearchXIcon, SettingsIcon } from "lucide-react"
import { useQueryState } from "nuqs"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"
import { useEffect } from "react"
import { ChatThread } from "@/components/chat/chat-thread"
import { PageTitle } from "@/components/common/page-title"
import {
  canModerate,
  channelsKey,
  fetchChannels,
  fetchMyGroups,
  myGroupsKey,
} from "@/components/groups/channel-data"
import { ChannelSettingsDialog } from "@/components/groups/channel-settings-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useApp } from "@/hooks/use-app"
import { rememberGroup } from "@/lib/last-group"
import { useDbQuery } from "@/lib/query"
import { channelSettingsParser } from "@/lib/search-params"

/** /groups/:groupSlug/c/:channelId — a channel's chat. */
const ChannelPage = () => {
  const { t } = useTranslation()
  const { me, isAdmin } = useApp()
  const params = useParams()
  const slug = params.groupSlug ?? ""
  const channelId = params.channelId ?? ""
  const [, setSettings] = useQueryState("settings", channelSettingsParser)

  const groups = useDbQuery(myGroupsKey(me.id), () => fetchMyGroups(me.id))
  const membership = groups.data?.find((m) => m.group.slug === slug)
  // a group with channels switched off has none to show
  const group = membership?.group.channelsEnabled ? membership.group : undefined
  const channels = useDbQuery(
    channelsKey(group?.id ?? ""),
    () => fetchChannels(group?.id ?? ""),
    { enabled: Boolean(group) }
  )
  const channel = channels.data?.find((c) => c.id === channelId)
  const parent = channel?.parentId
    ? channels.data?.find((c) => c.id === channel.parentId)
    : undefined

  useEffect(() => {
    if (group) rememberGroup(group.slug)
  }, [group])

  if (groups.isPending || (group && channels.isPending)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (!group || !channel?.conversationId) {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>{t("groups.channel.notFound")}</EmptyTitle>
          <EmptyDescription>
            {t("groups.channel.notFoundBody")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to={group ? `/groups/${group.slug}` : "/groups"}>
              {t("groups.channel.backToGroup")}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const crumb = (to: string, label: string) => (
    <>
      <Link
        to={to}
        className="hidden min-w-0 shrink truncate text-muted-foreground hover:text-foreground sm:inline"
      >
        {label}
      </Link>
      <span className="hidden text-muted-foreground/60 sm:inline">/</span>
    </>
  )

  return (
    <>
      <PageTitle title={`#${channel.name} · ${group.name}`} />
      <ChatThread
        key={channel.conversationId}
        conversationId={channel.conversationId}
        crumbs={
          <>
            {crumb(`/groups/${group.slug}`, group.name)}
            {parent
              ? crumb(`/groups/${group.slug}/c/${parent.id}`, `#${parent.name}`)
              : null}
            <HashIcon className="size-3 shrink-0 text-muted-foreground" />
            <h2 className="min-w-0 truncate font-medium" aria-current="page">
              {channel.name}
            </h2>
            {channel.topic ? (
              <span className="hidden min-w-0 truncate text-2xs text-muted-foreground lg:inline">
                · {channel.topic}
              </span>
            ) : null}
          </>
        }
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("groups.channel.settings")}
                onClick={() => void setSettings("general")}
              >
                <SettingsIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("groups.channel.settings")}</TooltipContent>
          </Tooltip>
        }
      />
      <ChannelSettingsDialog
        key={channel.id}
        channel={channel}
        groupSlug={group.slug}
        canManage={canModerate(membership.role, isAdmin)}
      />
    </>
  )
}

export default ChannelPage
