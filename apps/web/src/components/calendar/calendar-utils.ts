import {
  addDays,
  addMilliseconds,
  addMonths,
  addWeeks,
  areIntervalsOverlapping,
  differenceInMilliseconds,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isSameYear,
  max as maxDate,
  min as minDate,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { RRule, type Weekday } from "rrule"
import type { db } from "@/lib/api-client"

export type CalendarView = "month" | "week" | "day" | "agenda"

export const CALENDAR_VIEWS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
]

export const AGENDA_DAYS = 30

/** `include` shared by every calendar query so all views get the same shape. */
export const eventInclude = {
  attendees: {
    include: { user: { select: { id: true, name: true, image: true } } },
    orderBy: { createdAt: "asc" },
  },
  creator: { select: { id: true, name: true, image: true } },
  group: { select: { id: true, name: true, slug: true } },
} as const

export type CalendarEvent = Awaited<
  ReturnType<typeof db.event.findMany<{ include: typeof eventInclude }>>
>[number]

/** One concrete occurrence of an event (recurring events produce several). */
export type Occurrence = {
  key: string
  event: CalendarEvent
  start: Date
  end: Date
}

// ───────────────────────────── ranges ─────────────────────────────

export function viewRange(view: CalendarView, date: Date) {
  switch (view) {
    case "month":
      return {
        start: startOfWeek(startOfMonth(date)),
        end: endOfWeek(endOfMonth(date)),
      }
    case "week":
      return { start: startOfWeek(date), end: endOfWeek(date) }
    case "day":
      return { start: startOfDay(date), end: endOfDay(date) }
    case "agenda":
      return {
        start: startOfDay(date),
        end: endOfDay(addDays(date, AGENDA_DAYS - 1)),
      }
  }
}

export function stepDate(view: CalendarView, date: Date, dir: 1 | -1) {
  switch (view) {
    case "month":
      return addMonths(date, dir)
    case "week":
      return addWeeks(date, dir)
    case "day":
      return addDays(date, dir)
    case "agenda":
      return addDays(date, dir * AGENDA_DAYS)
  }
}

export function viewTitle(view: CalendarView, date: Date) {
  if (view === "month") return format(date, "MMMM yyyy")
  if (view === "day") return format(date, "EEEE, MMMM d, yyyy")
  const { start, end } = viewRange(view, date)
  if (isSameMonth(start, end)) return format(start, "MMMM yyyy")
  if (isSameYear(start, end))
    return `${format(start, "MMM")} – ${format(end, "MMM yyyy")}`
  return `${format(start, "MMM yyyy")} – ${format(end, "MMM yyyy")}`
}

export function daysOf(start: Date, end: Date) {
  const days: Date[] = []
  for (let d = startOfDay(start); d <= end; d = addDays(d, 1)) days.push(d)
  return days
}

// ───────────────────────────── recurrence ─────────────────────────────

/**
 * rrule computes in UTC. Feed it "floating" dates (local wall-clock fields stored as UTC) so
 * weekdays / days of month match what the user sees, then convert the results back.
 */
const toFloating = (d: Date) =>
  new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds()
    )
  )
const fromFloating = (d: Date) =>
  new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds()
  )

/** Expands events (including recurring ones) into occurrences overlapping [start, end]. */
export function expandOccurrences(
  events: CalendarEvent[],
  start: Date,
  end: Date
): Occurrence[] {
  const out: Occurrence[] = []
  for (const event of events) {
    const duration = Math.max(
      0,
      differenceInMilliseconds(event.endAt, event.startAt)
    )
    if (!event.rrule) {
      if (overlaps(event.startAt, event.endAt, start, end)) {
        out.push({
          key: event.id,
          event,
          start: event.startAt,
          end: event.endAt,
        })
      }
      continue
    }
    try {
      const rule = new RRule({
        ...RRule.parseString(event.rrule),
        dtstart: toFloating(event.startAt),
      })
      const starts = rule
        .between(
          toFloating(addMilliseconds(start, -duration)),
          toFloating(end),
          true
        )
        .map(fromFloating)
      for (const s of starts) {
        const e = addMilliseconds(s, duration)
        if (overlaps(s, e, start, end)) {
          out.push({
            key: `${event.id}:${s.getTime()}`,
            event,
            start: s,
            end: e,
          })
        }
      }
    } catch {
      // malformed rule: show the first occurrence only
      if (overlaps(event.startAt, event.endAt, start, end)) {
        out.push({
          key: event.id,
          event,
          start: event.startAt,
          end: event.endAt,
        })
      }
    }
  }
  return out.sort(
    (a, b) =>
      Number(b.event.allDay) - Number(a.event.allDay) ||
      a.start.getTime() - b.start.getTime() ||
      b.end.getTime() - a.end.getTime()
  )
}

function overlaps(s1: Date, e1: Date, s2: Date, e2: Date) {
  // zero-length events still show up at their start
  const end1 = e1 > s1 ? e1 : addMilliseconds(s1, 1)
  return areIntervalsOverlapping(
    { start: s1, end: end1 },
    { start: s2, end: e2 }
  )
}

export function occursOn(o: Occurrence, day: Date) {
  return overlaps(o.start, o.end, startOfDay(day), endOfDay(day))
}

/** All-day events and anything lasting 24h or more go in the all-day row of the time grid. */
export function isAllDayLike(o: Occurrence) {
  return (
    o.event.allDay ||
    !isSameDay(o.start, addMilliseconds(o.end, -1)) ||
    differenceInMilliseconds(o.end, o.start) >= 86_400_000
  )
}

export type RepeatOption = "none" | "daily" | "weekly" | "weekdays" | "monthly"

const WEEKDAYS = [
  RRule.SU,
  RRule.MO,
  RRule.TU,
  RRule.WE,
  RRule.TH,
  RRule.FR,
  RRule.SA,
] as const

export function repeatLabel(option: RepeatOption, start: Date) {
  switch (option) {
    case "none":
      return "Does not repeat"
    case "daily":
      return "Daily"
    case "weekly":
      return `Weekly on ${format(start, "EEEE")}`
    case "weekdays":
      return "Every weekday (Mon–Fri)"
    case "monthly":
      return `Monthly on day ${format(start, "d")}`
  }
}

export function buildRrule(option: RepeatOption, start: Date): string | null {
  const weekday = (WEEKDAYS[start.getDay()] ?? RRule.MO) as Weekday
  switch (option) {
    case "none":
      return null
    case "daily":
      return "FREQ=DAILY"
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${weekday.toString()}`
    case "weekdays":
      return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    case "monthly":
      return `FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}`
  }
}

export function parseRepeat(rrule: string | null | undefined): RepeatOption {
  if (!rrule) return "none"
  const rule = rrule.replace(/^RRULE:/, "").toUpperCase()
  if (rule === "FREQ=DAILY") return "daily"
  if (rule === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return "weekdays"
  if (rule.startsWith("FREQ=WEEKLY")) return "weekly"
  if (rule.startsWith("FREQ=MONTHLY")) return "monthly"
  return "daily"
}

export function describeRrule(rrule: string) {
  try {
    return RRule.fromString(rrule).toText()
  } catch {
    return "Repeats"
  }
}

// ───────────────────────────── time grid layout ─────────────────────────────

export type PositionedOccurrence = Occurrence & {
  /** minutes from midnight, clipped to the day */
  top: number
  bottom: number
  column: number
  columns: number
}

/** Lays out timed occurrences of one day: overlapping events share the width side by side. */
export function layoutDay(
  occurrences: Occurrence[],
  day: Date
): PositionedOccurrence[] {
  const dayStart = startOfDay(day)
  const dayEnd = endOfDay(day)
  const items = occurrences
    .map((o) => {
      const s = maxDate([o.start, dayStart])
      const e = minDate([o.end, dayEnd])
      const top = differenceInMilliseconds(s, dayStart) / 60_000
      // at least 20 minutes tall so short events stay clickable
      const bottom = Math.max(
        top + 20,
        differenceInMilliseconds(e, dayStart) / 60_000
      )
      return {
        ...o,
        top,
        bottom: Math.min(bottom, 24 * 60),
        column: 0,
        columns: 1,
      }
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom)

  const result: PositionedOccurrence[] = []
  let cluster: PositionedOccurrence[] = []
  let clusterEnd = -1
  const flush = () => {
    const columnEnds: number[] = []
    for (const item of cluster) {
      let col = columnEnds.findIndex((end) => end <= item.top)
      if (col === -1) {
        col = columnEnds.length
        columnEnds.push(item.bottom)
      } else columnEnds[col] = item.bottom
      item.column = col
    }
    for (const item of cluster) item.columns = columnEnds.length
    result.push(...cluster)
    cluster = []
  }
  for (const item of items) {
    if (cluster.length && item.top >= clusterEnd) {
      flush()
      clusterEnd = -1
    }
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.bottom)
  }
  flush()
  return result
}

export function formatTimeRange(o: {
  start: Date
  end: Date
  allDay: boolean
}) {
  if (o.allDay) {
    const last = addMilliseconds(o.end, -1)
    return isSameDay(o.start, last) || o.end <= o.start
      ? `${format(o.start, "EEEE, MMMM d")} · All day`
      : `${format(o.start, "MMM d")} – ${format(last, "MMM d")} · All day`
  }
  if (isSameDay(o.start, o.end))
    return `${format(o.start, "EEEE, MMMM d")} · ${format(o.start, "p")} – ${format(o.end, "p")}`
  return `${format(o.start, "MMM d, p")} – ${format(o.end, "MMM d, p")}`
}

export function shortTimeLabel(d: Date) {
  return format(d, d.getMinutes() === 0 ? "h a" : "h:mm a")
}
