import { cn } from "cn"
import { format, isSameDay } from "date-fns"
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  HelpCircleIcon,
  MapPinIcon,
  VideoIcon,
  XIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useNow } from "@/hooks/use-now"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { useDbMutation } from "@/lib/query"
import { Rsvp } from "@app/api/zenstack/models"
import type { FeedPost } from "./post-query"

type EventData = NonNullable<FeedPost["event"]>

const RSVP_OPTIONS = [
  { value: Rsvp.GOING, label: "Going", icon: CheckIcon },
  { value: Rsvp.MAYBE, label: "Maybe", icon: HelpCircleIcon },
  { value: Rsvp.DECLINED, label: "Can't go", icon: XIcon },
] as const

function timeRange(e: EventData) {
  if (e.allDay) {
    return isSameDay(e.startAt, e.endAt)
      ? "All day"
      : `${format(e.startAt, "MMM d")} – ${format(e.endAt, "MMM d")}`
  }
  return isSameDay(e.startAt, e.endAt)
    ? `${format(e.startAt, "EEE, MMM d · HH:mm")} – ${format(e.endAt, "HH:mm")}`
    : `${format(e.startAt, "MMM d, HH:mm")} – ${format(e.endAt, "MMM d, HH:mm")}`
}

/** Event announcement (Post type EVENT): date block, details and my RSVP. */
export function EventCard({ event }: { event: EventData }) {
  const { me } = useApp()
  const serverRsvp =
    event.attendees.find((a) => a.userId === me.id)?.rsvp ?? null
  const [pending, setPending] = useState<Rsvp | null>(null)
  const rsvp = pending ?? serverRsvp
  const rsvps = [
    ...event.attendees.filter((a) => a.userId !== me.id).map((a) => a.rsvp),
    ...(rsvp ? [rsvp] : []),
  ]
  const goingCount = rsvps.filter((r) => r === Rsvp.GOING).length
  const maybeCount = rsvps.filter((r) => r === Rsvp.MAYBE).length
  const past = event.endAt.getTime() < useNow()

  const respond = useDbMutation(
    (value: Rsvp) =>
      db.eventAttendee.upsert({
        where: { eventId_userId: { eventId: event.id, userId: me.id } },
        create: { eventId: event.id, userId: me.id, rsvp: value },
        update: { rsvp: value },
      }),
    { invalidates: ["eventAttendee", "event", "post"] }
  )

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex gap-4 bg-muted/40 p-4">
        <div className="flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-lg border bg-background text-center shadow-xs">
          <span className="w-full bg-primary py-0.5 text-[11px] font-semibold text-primary-foreground uppercase">
            {format(event.startAt, "MMM")}
          </span>
          <span className="py-1 text-2xl leading-none font-bold">
            {format(event.startAt, "d")}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-base leading-tight font-semibold">{event.title}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ClockIcon className="size-3.5 shrink-0" />
            {timeRange(event)}
          </p>
          {event.location ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPinIcon className="size-3.5 shrink-0" />
              <span className="truncate">{event.location}</span>
            </p>
          ) : null}
          {event.hasVideoCall ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <VideoIcon className="size-3.5 shrink-0" />
              Video call
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {goingCount} going{maybeCount ? ` · ${maybeCount} maybe` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t p-3">
        {past ? (
          <span className="text-sm text-muted-foreground">
            This event has ended
          </span>
        ) : (
          <div
            role="radiogroup"
            aria-label="Your RSVP"
            className="flex flex-wrap gap-2"
          >
            {RSVP_OPTIONS.map((o) => {
              const active = rsvp === o.value
              return (
                <Button
                  key={o.value}
                  role="radio"
                  aria-checked={active}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className={cn(!active && "text-muted-foreground")}
                  disabled={respond.isPending}
                  onClick={() => {
                    setPending(o.value)
                    respond.mutate(o.value, {
                      onError: (err) => toast.error(err.message),
                      onSettled: () => setPending(null),
                    })
                  }}
                >
                  <o.icon />
                  {o.label}
                </Button>
              )
            })}
          </div>
        )}
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link to={`/calendar?event=${event.id}`}>
            <CalendarIcon />
            View in calendar
          </Link>
        </Button>
      </div>
    </div>
  )
}
