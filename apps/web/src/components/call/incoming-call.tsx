import { PhoneIcon, PhoneOffIcon, VideoIcon } from "lucide-react"
import { useEffect, useId } from "react"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import type { CallSummary, UserSummary } from "@/lib/realtime-events"
import { Ringtone } from "@/lib/rtc/ringtone"

export type IncomingCall = {
  call: CallSummary
  from: UserSummary
  title: string
  receivedAt: number
}

/** Plays the ringtone while mounted. */
function useRingtone() {
  useEffect(() => {
    const ringtone = new Ringtone()
    ringtone.start()
    return () => ringtone.stop()
  }, [])
}

/** The incoming-call prompt (bottom-right card); rings while shown. */
export function IncomingCallCard({
  incoming,
  more,
  onAccept,
  onDecline,
}: {
  incoming: IncomingCall
  /** other calls waiting behind this one */
  more: number
  onAccept: () => void
  onDecline: () => void
}) {
  useRingtone()
  const titleId = useId()
  const descId = useId()
  const isVideo = incoming.call.type === "VIDEO"
  const showTitle = incoming.title && incoming.title !== incoming.from.name

  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed right-4 bottom-4 z-50 w-[min(22rem,calc(100vw-2rem))] animate-in rounded-2xl border bg-popover p-4 text-popover-foreground shadow-xl fade-in-0 slide-in-from-bottom-4"
    >
      <div className="flex items-center gap-3">
        <span className="relative inline-flex">
          <span
            className="absolute inset-0 animate-ping rounded-full bg-primary/30"
            aria-hidden
          />
          <UserAvatar user={incoming.from} size="lg" />
        </span>
        <div className="min-w-0 flex-1">
          <p id={titleId} className="truncate font-medium">
            {incoming.from.name}
          </p>
          <p
            id={descId}
            className="flex items-center gap-1.5 truncate text-sm text-muted-foreground"
          >
            {isVideo ? (
              <VideoIcon className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <PhoneIcon className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className="truncate">
              Incoming {isVideo ? "video" : "audio"} call
              {showTitle ? ` · ${incoming.title}` : ""}
            </span>
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          variant="secondary"
          className="flex-1 bg-destructive text-white hover:bg-destructive/85"
          onClick={onDecline}
          aria-label={`Decline call from ${incoming.from.name}`}
        >
          <PhoneOffIcon data-icon="inline-start" />
          Decline
        </Button>
        <Button
          className="flex-1 bg-emerald-600 text-white hover:bg-emerald-600/85"
          onClick={onAccept}
          aria-label={`Accept call from ${incoming.from.name}`}
        >
          {isVideo ? (
            <VideoIcon data-icon="inline-start" />
          ) : (
            <PhoneIcon data-icon="inline-start" />
          )}
          Accept
        </Button>
      </div>
      {more > 0 ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          +{more} more incoming call{more > 1 ? "s" : ""}
        </p>
      ) : null}
    </div>
  )
}
