import { useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import {
  CheckCircle2Icon,
  CircleHelpIcon,
  ClockIcon,
  MapPinIcon,
  PencilIcon,
  RepeatIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  XCircleIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useCalls } from "@/components/call/call-provider"
import { RichText } from "@/components/common/rich-text"
import { UserAvatar } from "@/components/common/user-avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { invalidateModels } from "@/lib/query"
import type { Rsvp } from "@app/api/zenstack/models"
import {
  type CalendarEvent,
  describeRrule,
  formatTimeRange,
} from "./calendar-utils"
import { EVENT_TYPE_STYLES, eventTypeLabelKey } from "./event-colors"
import { useCalendarEvent } from "./use-calendar-events"
import { ScrollArea } from "@/components/ui/scroll-area"

const RSVP_META: Record<
  Rsvp,
  { icon: typeof CheckCircle2Icon; className: string }
> = {
  GOING: {
    icon: CheckCircle2Icon,
    className: "text-success",
  },
  MAYBE: {
    icon: CircleHelpIcon,
    className: "text-warning",
  },
  DECLINED: {
    icon: XCircleIcon,
    className: "text-destructive",
  },
  PENDING: {
    icon: ClockIcon,
    className: "text-muted-foreground",
  },
}

type Props = {
  eventId: string | null
  /** the clicked occurrence (recurring events): shown instead of the series start */
  occurrence?: { start: Date; end: Date } | null
  onOpenChange: (open: boolean) => void
  onEdit: (event: CalendarEvent) => void
}

export function EventDetailsSheet({
  eventId,
  occurrence,
  onOpenChange,
  onEdit,
}: Props) {
  const { t } = useTranslation()
  const { data: event, isPending, error } = useCalendarEvent(eventId)

  return (
    <Sheet open={Boolean(eventId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="[&>div]:h-full"
        >
          <div className="flex min-h-full flex-col">
            {event ? (
              <EventDetailsBody
                event={event}
                occurrence={occurrence}
                onEdit={onEdit}
                onClose={() => onOpenChange(false)}
              />
            ) : (
              <>
                <SheetHeader>
                  <SheetTitle>
                    {isPending ? (
                      <Skeleton className="h-6 w-48" />
                    ) : (
                      t("calendar.details.notFound")
                    )}
                  </SheetTitle>
                  <SheetDescription>
                    {isPending
                      ? t("calendar.details.loading")
                      : error
                        ? errorMessage(error)
                        : t("calendar.details.noAccess")}
                  </SheetDescription>
                </SheetHeader>
                {isPending ? (
                  <div className="flex flex-col gap-3 p-4">
                    <Skeleton className="h-4 w-56" />
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : null}
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function EventDetailsBody({
  event,
  occurrence,
  onEdit,
  onClose,
}: {
  event: CalendarEvent
  occurrence?: { start: Date; end: Date } | null
  onEdit: (event: CalendarEvent) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { me } = useApp()
  const { startCall } = useCalls()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  const style = EVENT_TYPE_STYLES[event.type]
  const TypeIcon = style.icon
  const isCreator = event.creatorId === me.id
  const mine = event.attendees.find((a) => a.userId === me.id)
  const canRsvp =
    Boolean(mine) || (event.groupId !== null && event.type !== "OUT_OF_OFFICE")
  const start = occurrence?.start ?? event.startAt
  const end = occurrence?.end ?? event.endAt
  const counts = event.attendees.reduce<Record<string, number>>((acc, a) => {
    acc[a.rsvp] = (acc[a.rsvp] ?? 0) + 1
    return acc
  }, {})

  const rsvp = async (value: Rsvp) => {
    try {
      await db.eventAttendee.upsert({
        where: { eventId_userId: { eventId: event.id, userId: me.id } },
        create: { eventId: event.id, userId: me.id, rsvp: value },
        update: { rsvp: value },
      })
      await invalidateModels(queryClient, ["event", "eventAttendee"])
    } catch (err) {
      toast.error(t("calendar.details.rsvpFailed"), {
        description: errorMessage(err),
      })
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await db.event.delete({ where: { id: event.id } })
      // the group announcement goes with it
      if (event.postId)
        await db.post
          .delete({ where: { id: event.postId } })
          .catch(() => undefined)
      await invalidateModels(queryClient, ["event", "eventAttendee", "post"])
      toast.success(t("calendar.details.deleted"))
      setConfirmDelete(false)
      onClose()
    } catch (err) {
      toast.error(t("calendar.details.deleteFailed"), {
        description: errorMessage(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SheetHeader className="gap-3 border-b pr-12">
        <Badge variant="outline" className="w-fit gap-1.5">
          <span className={cn("size-2 rounded-full", style.dot)} aria-hidden />
          <TypeIcon />
          {t(eventTypeLabelKey(event.type))}
        </Badge>
        <SheetTitle className="text-xl leading-tight">{event.title}</SheetTitle>
        <SheetDescription className="flex flex-col gap-1">
          <span className="flex items-start gap-2">
            <ClockIcon className="mt-0.5 size-4 shrink-0" />
            {formatTimeRange({ start, end, allDay: event.allDay })}
          </span>
          {event.rrule ? (
            <span className="flex items-start gap-2">
              <RepeatIcon className="mt-0.5 size-4 shrink-0" />
              <span className="first-letter:uppercase">
                {describeRrule(event.rrule, event.startAt)}
              </span>
            </span>
          ) : null}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 p-4">
        {event.hasVideoCall ? (
          <Button
            className="w-full"
            onClick={() => void startCall({ eventId: event.id, type: "VIDEO" })}
          >
            <VideoIcon />
            {t("calendar.details.joinVideo")}
          </Button>
        ) : null}

        <dl className="flex flex-col gap-3 text-sm">
          {event.location ? (
            <div className="flex items-start gap-3">
              <dt>
                <MapPinIcon
                  className="size-4 text-muted-foreground"
                  aria-label={t("calendar.details.location")}
                />
              </dt>
              <dd className="break-words">{event.location}</dd>
            </div>
          ) : null}
          {event.group ? (
            <div className="flex items-start gap-3">
              <dt>
                <UsersIcon
                  className="size-4 text-muted-foreground"
                  aria-label={t("calendar.details.group")}
                />
              </dt>
              <dd>
                <Link
                  to={`/groups/${event.group.slug}`}
                  className="font-medium hover:underline"
                >
                  {event.group.name}
                </Link>
              </dd>
            </div>
          ) : null}
          <div className="flex items-start gap-3">
            <dt>
              <UserIcon
                className="size-4 text-muted-foreground"
                aria-label={t("calendar.details.organizer")}
              />
            </dt>
            <dd>
              <Trans
                i18nKey="calendar.details.organizedBy"
                values={{
                  name:
                    event.creator.id === me.id
                      ? t("common.you")
                      : event.creator.name,
                }}
                components={{
                  link: (
                    <Link
                      to={`/people/${event.creator.id}`}
                      className="font-medium hover:underline"
                    />
                  ),
                }}
              />
            </dd>
          </div>
        </dl>

        {event.description ? (
          <>
            <Separator />
            <RichText text={event.description} className="text-sm" />
          </>
        ) : null}

        {canRsvp ? (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                {t("calendar.details.going")}
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                spacing={0}
                value={mine?.rsvp && mine.rsvp !== "PENDING" ? mine.rsvp : ""}
                onValueChange={(v) => v && void rsvp(v as Rsvp)}
                aria-label={t("calendar.details.yourResponse")}
              >
                {(["GOING", "MAYBE", "DECLINED"] as const).map((value) => {
                  const meta = RSVP_META[value]
                  const Icon = meta.icon
                  return (
                    <ToggleGroupItem key={value} value={value} className="px-3">
                      <Icon className={meta.className} />
                      {t(`calendar.rsvpAnswer.${value}`)}
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </div>
          </>
        ) : null}

        {event.attendees.length > 0 ? (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {t("calendar.details.guests", {
                    count: event.attendees.length,
                  })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {(["GOING", "MAYBE", "DECLINED", "PENDING"] as const)
                    .filter((r) => counts[r])
                    .map((r) =>
                      t("calendar.details.rsvpCount", {
                        count: counts[r],
                        label: t(`calendar.rsvp.${r}`).toLowerCase(),
                      })
                    )
                    .join(" · ")}
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {event.attendees.map((a) => {
                  const meta = RSVP_META[a.rsvp]
                  const Icon = meta.icon
                  return (
                    <li
                      key={a.id}
                      className="flex items-center gap-2.5 rounded-md py-1"
                    >
                      <span className="relative">
                        <UserAvatar user={a.user} size="sm" />
                        <Icon
                          className={cn(
                            "absolute -right-1 -bottom-1 size-3.5 rounded-full bg-background",
                            meta.className
                          )}
                          aria-hidden
                        />
                      </span>
                      <Link
                        to={`/people/${a.user.id}`}
                        className="min-w-0 flex-1 truncate text-sm hover:underline"
                      >
                        {a.user.name}
                        {a.userId === event.creatorId ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {t("calendar.details.organizer")}
                          </span>
                        ) : null}
                      </Link>
                      <span className={cn("text-xs", meta.className)}>
                        {t(`calendar.rsvp.${a.rsvp}`)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        ) : null}
      </div>

      {isCreator ? (
        <SheetFooter className="mt-auto flex-row justify-end border-t">
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2Icon />
            {t("common.delete")}
          </Button>
          <Button variant="outline" onClick={() => onEdit(event)}>
            <PencilIcon />
            {t("common.edit")}
          </Button>
        </SheetFooter>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("calendar.details.deleteTitle", { title: event.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {event.rrule ? t("calendar.details.deleteRecurring") : ""}
              {t("calendar.details.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                void remove()
              }}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
