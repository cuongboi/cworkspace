import { addDays, addHours, setHours, startOfDay, startOfHour } from "date-fns"
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react"
import { useQueryState } from "nuqs"
import { useState } from "react"
import { AgendaView } from "@/components/calendar/agenda-view"
import { CalendarSidebar } from "@/components/calendar/calendar-sidebar"
import {
  CALENDAR_VIEWS,
  type CalendarEvent,
  type CalendarView,
  expandOccurrences,
  type Occurrence,
  stepDate,
  viewRange,
  viewTitle,
} from "@/components/calendar/calendar-utils"
import { EVENT_TYPES } from "@/components/calendar/event-colors"
import { EventDetailsSheet } from "@/components/calendar/event-details"
import {
  EventDialog,
  type EventDialogDefaults,
} from "@/components/calendar/event-dialog"
import { MonthView } from "@/components/calendar/month-view"
import { TimeGridView } from "@/components/calendar/time-grid-view"
import {
  useCalendarEvent,
  useCalendarEvents,
} from "@/components/calendar/use-calendar-events"
import { PageTitle } from "@/components/common/page-title"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/use-mobile"
import { useApp } from "@/hooks/use-app"
import type { EventType } from "@app/api/zenstack/models"

type DialogState = {
  key: number
  event: CalendarEvent | null
  defaults?: EventDialogDefaults
} | null

const CalendarPage = () => {
  const { me } = useApp()
  const [view, setView] = useState<CalendarView>("week")
  const [date, setDate] = useState(() => new Date())
  const [types, setTypes] = useState<Set<EventType>>(() => new Set(EVENT_TYPES))
  const [mineOnly, setMineOnly] = useState(false)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [selected, setSelected] = useState<{
    eventId: string
    occurrence: Occurrence | null
  } | null>(null)

  // phones start on the day view (a 7-column week is too cramped)
  const isMobile = useIsMobile()
  const [viewAdjusted, setViewAdjusted] = useState(false)
  if (isMobile && !viewAdjusted) {
    setViewAdjusted(true)
    setView("day")
  }

  // deep link: ?event=<id> opens the event and moves the view to its date
  const [deepLinkId, setDeepLinkId] = useQueryState("event")
  const { data: linked } = useCalendarEvent(deepLinkId)
  // recurring: show the next occurrence rather than the series start
  const linkedNext = linked?.rrule
    ? expandOccurrences(
        [linked],
        startOfDay(new Date()),
        addDays(new Date(), 366)
      )[0]
    : undefined
  const [jumpedTo, setJumpedTo] = useState<string | null>(null)
  if (linked && jumpedTo !== linked.id) {
    setJumpedTo(linked.id)
    setDate(linkedNext?.start ?? linked.startAt)
  }
  const openEventId = selected?.eventId ?? deepLinkId

  const range = viewRange(view, date)
  const {
    data: events = [],
    isPending,
    isFetching,
  } = useCalendarEvents(range.start, range.end)
  const occurrences = expandOccurrences(
    events.filter(
      (e) =>
        types.has(e.type) &&
        (!mineOnly ||
          e.creatorId === me.id ||
          e.attendees.some((a) => a.userId === me.id && a.rsvp !== "DECLINED"))
    ),
    range.start,
    range.end
  )

  const openCreate = (start?: Date, allDay?: boolean) => {
    const at = start ?? startOfHour(addHours(new Date(), 1))

    if (at < new Date()) {
      return
    }

    setDialog({
      key: Date.now(),
      event: null,
      defaults: { start: at, allDay },
    })
  }

  const closeDetails = () => {
    setSelected(null)
    if (deepLinkId) {
      void setDeepLinkId(null)
    }
  }

  const openDay = (day: Date) => {
    setDate(day)
    setView("day")
  }

  return (
    <>
      <PageTitle title="Calendar" />
      <div className="flex h-full min-h-0 flex-1">
        <CalendarSidebar
          className="hidden lg:flex"
          date={date}
          onDateChange={setDate}
          types={types}
          onTypesChange={setTypes}
          mineOnly={mineOnly}
          onMineOnlyChange={setMineOnly}
          onCreate={() =>
            openCreate(view === "month" ? setHours(date, 9) : undefined)
          }
        />
        <section className="flex min-w-0 flex-1 flex-col" aria-label="Calendar">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <Button variant="outline" onClick={() => setDate(new Date())}>
              Today
            </Button>
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDate(stepDate(view, date, -1))}
                    aria-label="Previous"
                  >
                    <ChevronLeftIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Previous {view === "agenda" ? "period" : view}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDate(stepDate(view, date, 1))}
                    aria-label="Next"
                  >
                    <ChevronRightIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Next {view === "agenda" ? "period" : view}
                </TooltipContent>
              </Tooltip>
            </div>
            <h1
              className="min-w-0 truncate text-lg font-semibold sm:text-xl"
              aria-live="polite"
            >
              {viewTitle(view, date)}
            </h1>
            {isFetching && !isPending ? (
              <Spinner className="text-muted-foreground" />
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                spacing={0}
                value={view}
                onValueChange={(v) => v && setView(v as CalendarView)}
                className="hidden md:flex"
                aria-label="View"
              >
                {CALENDAR_VIEWS.map((v) => (
                  <ToggleGroupItem
                    key={v.value}
                    value={v.value}
                    className="px-3"
                  >
                    {v.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <NativeSelect
                size="sm"
                value={view}
                onChange={(e) => setView(e.target.value as CalendarView)}
                className="md:hidden"
                aria-label="View"
              >
                {CALENDAR_VIEWS.map((v) => (
                  <NativeSelectOption key={v.value} value={v.value}>
                    {v.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                onClick={() => openCreate()}
                className="lg:hidden"
                aria-label="New event"
              >
                <PlusIcon />
                <span className="hidden sm:inline">New event</span>
              </Button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
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
                onSelect={(o) =>
                  setSelected({ eventId: o.event.id, occurrence: o })
                }
                onCreate={(start) => openCreate(start)}
                onOpenDay={openDay}
              />
            ) : view === "agenda" ? (
              <AgendaView
                range={range}
                occurrences={occurrences}
                onSelect={(o) =>
                  setSelected({ eventId: o.event.id, occurrence: o })
                }
                onCreate={() => openCreate()}
              />
            ) : (
              <TimeGridView
                range={range}
                occurrences={occurrences}
                onSelect={(o) =>
                  setSelected({ eventId: o.event.id, occurrence: o })
                }
                onCreate={(start, allDay) => openCreate(start, allDay)}
                onOpenDay={openDay}
              />
            )}
          </div>
        </section>
      </div>

      <EventDetailsSheet
        eventId={openEventId}
        occurrence={selected ? selected.occurrence : linkedNext}
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
            if (!dialog.event) setSelected({ eventId: id, occurrence: null })
          }}
        />
      ) : null}
    </>
  )
}

export default CalendarPage
