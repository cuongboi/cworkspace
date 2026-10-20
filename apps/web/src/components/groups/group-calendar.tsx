import { addHours, setHours, startOfHour } from "date-fns"
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react"
import { useQueryState } from "nuqs"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AgendaView } from "@/components/calendar/agenda-view"
import {
  type CalendarEvent,
  expandOccurrences,
  type Occurrence,
  stepDate,
  viewRange,
  viewTitle,
} from "@/components/calendar/calendar-utils"
import { EventDetailsSheet } from "@/components/calendar/event-details"
import {
  EventDialog,
  type EventDialogDefaults,
} from "@/components/calendar/event-dialog"
import { MonthView } from "@/components/calendar/month-view"
import { useCalendarEvents } from "@/components/calendar/use-calendar-events"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { GroupWithMe } from "./group-query"

type View = "month" | "agenda"

type DialogState = {
  key: number
  event: CalendarEvent | null
  defaults?: EventDialogDefaults
} | null

/** The group's events (month grid or agenda). Members create events in this group only. */
export function GroupCalendar({
  group,
  canCreate,
}: {
  group: GroupWithMe
  canCreate: boolean
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<View>("month")
  const [date, setDate] = useState(() => new Date())
  const [dialog, setDialog] = useState<DialogState>(null)
  const [selected, setSelected] = useState<Occurrence | null>(null)
  // deep link (and shareable state): ?event=<id>
  const [eventId, setEventId] = useQueryState("event")

  const range = viewRange(view, date)
  const {
    data: events = [],
    isPending,
    isFetching,
  } = useCalendarEvents(range.start, range.end, { groupId: group.id })
  const occurrences = expandOccurrences(events, range.start, range.end)

  const openCreate = (start?: Date) => {
    if (!canCreate) return
    setDialog({
      key: Date.now(),
      event: null,
      defaults: {
        start: start ?? startOfHour(addHours(new Date(), 1)),
        group: { id: group.id, name: group.name },
      },
    })
  }
  const select = (o: Occurrence) => {
    setSelected(o)
    void setEventId(o.event.id)
  }
  const closeDetails = () => {
    setSelected(null)
    void setEventId(null)
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="sm" onClick={() => setDate(new Date())}>
          {t("calendar.today")}
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("calendar.previous")}
            onClick={() => setDate(stepDate(view, date, -1))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("calendar.next")}
            onClick={() => setDate(stepDate(view, date, 1))}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <h2 className="min-w-0 truncate font-semibold" aria-live="polite">
          {viewTitle(view, date)}
        </h2>
        {isFetching && !isPending ? (
          <Spinner className="text-muted-foreground" />
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={view}
            onValueChange={(v) => v && setView(v as View)}
            aria-label={t("calendar.view")}
          >
            <ToggleGroupItem value="month" className="px-3">
              {t("calendar.views.month")}
            </ToggleGroupItem>
            <ToggleGroupItem value="agenda" className="px-3">
              {t("calendar.views.agenda")}
            </ToggleGroupItem>
          </ToggleGroup>
          {canCreate ? (
            <Button size="sm" onClick={() => openCreate()}>
              <PlusIcon />
              <span className="hidden sm:inline">{t("calendar.newEvent")}</span>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative flex min-h-128 flex-col">
        {isPending ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60">
            <Spinner className="size-6" />
          </div>
        ) : null}
        {view === "month" ? (
          <MonthView
            date={date}
            range={range}
            occurrences={occurrences}
            onSelect={select}
            onCreate={(start) => openCreate(setHours(start, 9))}
            onOpenDay={(day) => {
              setDate(day)
              setView("agenda")
            }}
          />
        ) : (
          <AgendaView
            range={range}
            occurrences={occurrences}
            onSelect={select}
            onCreate={() => openCreate()}
          />
        )}
      </div>

      <EventDetailsSheet
        eventId={eventId}
        occurrence={selected}
        onOpenChange={(open) => !open && closeDetails()}
        onEdit={(event) => {
          closeDetails()
          setDialog({ key: Date.now(), event })
        }}
      />

      {dialog ? (
        <EventDialog
          key={dialog.key}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          event={dialog.event}
          defaults={dialog.defaults}
          onSaved={(id) => {
            if (!dialog.event) void setEventId(id)
          }}
        />
      ) : null}
    </div>
  )
}
