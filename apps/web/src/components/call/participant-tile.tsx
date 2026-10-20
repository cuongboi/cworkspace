import { cn } from "cn"
import { Loader2Icon, MicOffIcon, MonitorUpIcon } from "lucide-react"
import { UserAvatar } from "@/components/common/user-avatar"
import type { UserSummary } from "@/lib/realtime-events"
import { StreamVideo } from "./media-elements"
import { useTranslation } from "react-i18next"

export type TileProps = {
  user: UserSummary
  /** label override ("You") */
  label?: string
  stream: MediaStream | null
  /** the participant is sending video (camera on or screen) */
  videoOn: boolean
  micOn: boolean
  speaking?: boolean
  /** the loudest participant right now */
  active?: boolean
  mirrored?: boolean
  presenting?: boolean
  connecting?: boolean
  fit?: "cover" | "contain"
  size?: "default" | "small"
  className?: string
}

export function ParticipantTile({
  user,
  label,
  stream,
  videoOn,
  micOn,
  speaking = false,
  active = false,
  mirrored = false,
  presenting = false,
  connecting = false,
  fit = "cover",
  size = "default",
  className,
}: TileProps) {
  const { t } = useTranslation()
  const showVideo = videoOn && Boolean(stream?.getVideoTracks().length)
  const name = label ?? user.name

  return (
    <figure
      aria-label={`${name}${micOn ? "" : t("call.tile.mutedSuffix")}${speaking ? t("call.tile.speakingSuffix") : ""}`}
      className={cn(
        "relative isolate flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40 ring-2 ring-transparent transition-shadow duration-150",
        speaking && "ring-primary",
        active && !speaking && "ring-primary/40",
        className
      )}
    >
      {showVideo ? (
        <StreamVideo
          stream={stream}
          mirrored={mirrored}
          fit={fit}
          className="absolute inset-0"
        />
      ) : (
        <div className="flex flex-col items-center gap-2">
          <span
            className={cn(
              "rounded-full transition-shadow",
              speaking && "shadow-[0_0_0_6px] shadow-primary/40"
            )}
          >
            <UserAvatar
              user={user}
              size={size === "small" ? "default" : "xl"}
            />
          </span>
        </div>
      )}

      {connecting ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60 text-sm text-muted-foreground backdrop-blur-sm">
          <Loader2Icon className="size-4 animate-spin" aria-hidden />
          {t("call.tile.connecting")}
        </div>
      ) : null}

      <figcaption
        className={cn(
          "absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-background/70 px-2 py-1 text-foreground backdrop-blur-sm",
          size === "small" ? "text-2xs" : "text-xs"
        )}
      >
        {presenting ? (
          <MonitorUpIcon className="size-3.5 shrink-0" aria-hidden />
        ) : null}
        <span className="truncate">{name}</span>
        {micOn ? null : (
          <MicOffIcon
            className="size-3.5 shrink-0 text-destructive"
            aria-label={t("call.tile.muted")}
          />
        )}
      </figcaption>
    </figure>
  )
}
