import { cn } from "cn"
import { format, isSameDay, type Locale } from "date-fns"
import type { TFunction } from "i18next"
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  HelpCircleIcon,
  MapPinIcon,
  VideoIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useNow } from "@/hooks/use-now"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { errorMessage, useDateLocale } from "@/lib/i18n"
import { useDbMutation } from "@/lib/query"
import { Rsvp } from "@app/api/zenstack/models"
import type { FeedPost } from "./post-query"

type EventData = NonNullable<FeedPost["event"]>

const RSVP_OPTIONS = [
  { value: Rsvp.GOING, label: "feed.event.going", icon: CheckIcon },
  { value: Rsvp.MAYBE, label: "feed.event.maybe", icon: HelpCircleIcon },
  { value: Rsvp.DECLINED, label: "feed.event.declined", icon: XIcon },
] as const

function timeRange(e: EventData, t: TFunction, locale: Locale) {
  const day = t("feed.dateFormat.monthDay")
  const f = (d: Date, pattern: string) => format(d, pattern, { locale })
  if (e.allDay) {
    return isSameDay(e.startAt, e.endAt)
      ? t("feed.event.allDay")
      : `${f(e.startAt, day)} – ${f(e.endAt, day)}`
  }
  return isSameDay(e.startAt, e.endAt)
    ? `${f(e.startAt, t("feed.dateFormat.weekdayMonthDay"))} · ${f(e.startAt, "HH:mm")} – ${f(e.endAt, "HH:mm")}`
    : `${f(e.startAt, day)} ${f(e.startAt, "HH:mm")} – ${f(e.endAt, day)} ${f(e.endAt, "HH:mm")}`
}

/** Event announcement (Post type EVENT): date block, details and my RSVP. */
export function EventCard({ event }: { event: EventData }) {
  const { t } = useTranslation()
  const locale = useDateLocale()
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
        <div className="flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-lg border bg-background text-center">
          <span className="w-full bg-primary py-0.5 text-2xs font-semibold text-primary-foreground uppercase">
            {format(event.startAt, "MMM", { locale })}
          </span>
          <span className="py-1 text-2xl leading-none font-bold">
            {format(event.startAt, "d", { locale })}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-base leading-tight font-semibold">{event.title}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ClockIcon className="size-3.5 shrink-0" />
            {timeRange(event, t, locale)}
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
              {t("feed.event.videoCall")}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {t("feed.event.goingCount", { count: goingCount })}
            {maybeCount
              ? ` · ${t("feed.event.maybeCount", { count: maybeCount })}`
              : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t p-3">
        {past ? (
          <span className="text-sm text-muted-foreground">
            {t("feed.event.ended")}
          </span>
        ) : (
          <div
            role="radiogroup"
            aria-label={t("feed.event.yourRsvp")}
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
                      onError: (err) => toast.error(errorMessage(err)),
                      onSettled: () => setPending(null),
                    })
                  }}
                >
                  <o.icon />
                  {t(o.label)}
                </Button>
              )
            })}
          </div>
        )}
        <Button asChild size="sm" variant="ghost" className="ml-auto">
          <Link to={`/calendar?event=${event.id}`}>
            <CalendarIcon />
            {t("feed.event.viewInCalendar")}
          </Link>
        </Button>
      </div>
    </div>
  )
}
