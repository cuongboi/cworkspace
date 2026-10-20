import { PhoneIcon, VideoIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useCalls } from "@/components/call/call-provider"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useApp } from "@/hooks/use-app"
import {
  type CallKind,
  type GroupCallState,
  MAX_MESH_PARTICIPANTS,
} from "@/lib/realtime-events"

/**
 * "Call" menu: starts the group's drop-in call. While a call is live it becomes a Join button
 * (the server joins callers to the live call anyway: one call per group).
 */
export function GroupCallButton({
  groupId,
  live,
}: {
  groupId: string
  live: GroupCallState | null
}) {
  const { t } = useTranslation()
  const { startCall, joinCall } = useCalls()
  const [busy, setBusy] = useState(false)

  if (live?.call) {
    return <JoinButton live={live} onJoin={() => joinCall(live.call!.id)} />
  }

  const start = async (type: CallKind) => {
    setBusy(true)
    try {
      await startCall({ groupId, type })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" disabled={busy}>
          <VideoIcon /> {t("groups.call.call")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void start("VIDEO")}>
          <VideoIcon /> {t("groups.call.startVideo")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void start("AUDIO")}>
          <PhoneIcon /> {t("groups.call.startAudio")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Banner shown to members while the group's call is live: who's in it, and a Join button. */
export function GroupLiveCallBanner({ live }: { live: GroupCallState }) {
  const { t } = useTranslation()
  const { joinCall } = useCalls()
  const { me } = useApp()
  if (!live.call) return null
  const Icon = live.call.type === "VIDEO" ? VideoIcon : PhoneIcon
  const count = live.participants.length
  const inIt = live.participants.some((p) => p.id === me.id)
  const names = live.participants.map((p) => p.name.split(/\s+/)[0]).join(", ")

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-subtle p-3"
    >
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
        <Icon className="size-4" aria-hidden />
        <span className="absolute top-0 right-0 size-2.5 animate-pulse rounded-full bg-destructive ring-2 ring-background" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {live.call.type === "VIDEO"
            ? t("groups.call.liveVideo")
            : t("groups.call.liveAudio")}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {count === 0
            ? t("groups.call.starting")
            : `${names} · ${count}/${MAX_MESH_PARTICIPANTS}`}
        </p>
      </div>
      <div className="hidden -space-x-2 sm:flex">
        {live.participants.slice(0, 4).map((p) => (
          <UserAvatar
            key={p.id}
            user={p}
            size="sm"
            className="rounded-full ring-2 ring-card"
          />
        ))}
      </div>
      {inIt ? (
        <Button variant="secondary" onClick={() => joinCall(live.call!.id)}>
          {t("groups.call.return")}
        </Button>
      ) : (
        <JoinButton live={live} onJoin={() => joinCall(live.call!.id)} />
      )}
    </div>
  )
}

function JoinButton({
  live,
  onJoin,
}: {
  live: GroupCallState
  onJoin: () => void
}) {
  const { t } = useTranslation()
  const full = live.participants.length >= MAX_MESH_PARTICIPANTS
  const button = (
    <Button
      variant={full ? "secondary" : "success"}
      onClick={onJoin}
      disabled={full}
    >
      {live.call?.type === "AUDIO" ? <PhoneIcon /> : <VideoIcon />}
      {t("groups.call.join")}
    </Button>
  )
  if (!full) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* a disabled button doesn't fire pointer events: wrap it for the tooltip */}
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>
        {t("groups.call.full", { max: MAX_MESH_PARTICIPANTS })}
      </TooltipContent>
    </Tooltip>
  )
}
