import { cn } from "cn"
import {
  addMinutes,
  differenceInMinutes,
  format,
  isToday,
  setHours,
  startOfDay,
} from "date-fns"
import { type MouseEvent, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useDateLocale } from "@/lib/i18n"
import {
  daysOf,
  isAllDayLike,
  layoutDay,
  type Occurrence,
  occursOn,
  shortTimeLabel,
} from "./calendar-utils"
import { EVENT_TYPE_STYLES } from "./event-colors"
import { ScrollArea } from "@/components/ui/scroll-area"

const HOUR_HEIGHT = 48 // px
const HOURS = Array.from({ length: 24 }, (_, h) => h)

type Props = {
  range: { start: Date; end: Date }
  occurrences: Occurrence[]
  onSelect: (o: Occurrence) => void
  onCreate: (start: Date, allDay?: boolean) => void
  onOpenDay: (day: Date) => void
}

/** Week / day view: an all-day row and a 24h time grid with overlapping events side by side. */
export function TimeGridView({
  range,
  occurrences,
  onSelect,
  onCreate,
  onOpenDay,
}: Props) {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const days = daysOf(range.start, range.end)
  const scrollRef = useRef<HTMLDivElement>(null)
  const now = useNow()

  const allDay = occurrences.filter(isAllDayLike)
  const timed = occurrences.filter((o) => !isAllDayLike(o))

  // start scrolled to the morning (or just before the current time)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const hour = Math.max(0, Math.min(new Date().getHours() - 1, 7))
    el.scrollTop = hour * HOUR_HEIGHT
  }, [])

  const gridCols = {
    gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`,
  }

  const handleSlotClick = (day: Date, e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const minutes = ((e.clientY - rect.top) / HOUR_HEIGHT) * 60
    const snapped = Math.max(
      0,
      Math.min(23 * 60 + 30, Math.floor(minutes / 30) * 30)
    )
    onCreate(addMinutes(startOfDay(day), snapped))
  }

  return (
    <ScrollArea viewportRef={scrollRef} className="min-h-0 flex-1">
      <div className="sticky top-0 z-20 bg-background">
        {/* day headers */}
        <div className="grid border-b" style={gridCols}>
          <div />
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className="flex flex-col items-center gap-0.5 border-l py-2"
            >
              <span
                className={cn(
                  "text-2xs font-medium uppercase",
                  isToday(day) ? "text-primary" : "text-muted-foreground"
                )}
              >
                {format(day, "EEE", { locale })}
              </span>
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                aria-label={format(day, "PPPP", { locale })}
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-lg font-medium hover:bg-muted",
                  isToday(day) &&
                    "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {format(day, "d", { locale })}
              </button>
            </div>
          ))}
        </div>

        {/* all-day row */}
        <div className="grid border-b" style={gridCols}>
          <div className="flex items-start justify-end px-2 py-1 text-2xs text-muted-foreground">
            {t("calendar.allDayShort")}
          </div>
          {days.map((day) => {
            const items = allDay.filter((o) => occursOn(o, day))
            return (
              // biome-ignore lint/a11y/useSemanticElements: cell containing buttons
              <div
                key={day.toISOString()}
                role="button"
                tabIndex={-1}
                aria-label={t("calendar.createAllDayEventOn", {
                  date: format(day, "PPPP", { locale }),
                })}
                onClick={() => onCreate(setHours(day, 0), true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCreate(setHours(day, 0), true)
                }}
                className="flex min-h-8 min-w-0 cursor-pointer flex-col gap-0.5 border-l p-0.5 hover:bg-muted/40"
              >
                {items.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(o)
                    }}
                    title={o.event.title}
                    className={cn(
                      "truncate rounded-sm px-1.5 py-0.5 text-left text-xs font-medium",
                      EVENT_TYPE_STYLES[o.event.type].chip
                    )}
                  >
                    {o.event.title}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* time grid */}
      <div
        className="relative grid"
        style={{ ...gridCols, height: HOUR_HEIGHT * 24 }}
      >
        {/* hour labels */}
        <div className="relative">
          {HOURS.map((h) =>
            h === 0 ? null : (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 text-2xs text-muted-foreground tabular-nums"
                style={{ top: h * HOUR_HEIGHT }}
              >
                {shortTimeLabel(setHours(startOfDay(range.start), h))}
              </span>
            )
          )}
        </div>
        {days.map((day) => {
          const positioned = layoutDay(
            timed.filter((o) => occursOn(o, day)),
            day
          )
          const minutesNow = differenceInMinutes(now, startOfDay(day))
          return (
            // biome-ignore lint/a11y/useSemanticElements: time slots containing buttons
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={-1}
              aria-label={t("calendar.createEventOn", {
                date: format(day, "PPPP", { locale }),
              })}
              className="relative cursor-pointer border-l"
              onClick={(e) => handleSlotClick(day, e)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCreate(setHours(day, 9))
              }}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="pointer-events-none absolute inset-x-0 border-t border-border/70"
                  style={{ top: h * HOUR_HEIGHT }}
                >
                  <div
                    className="absolute inset-x-0 border-t border-dashed border-border/40"
                    style={{ top: HOUR_HEIGHT / 2 }}
                  />
                </div>
              ))}
              {positioned.map((o) => {
                const height = ((o.bottom - o.top) / 60) * HOUR_HEIGHT
                const compact = height < 40
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(o)
                    }}
                    title={`${o.event.title} · ${shortTimeLabel(o.start)} – ${shortTimeLabel(o.end)}`}
                    className="absolute overflow-hidden rounded-sm bg-background text-left text-xs ring-1 ring-background"
                    style={{
                      top: (o.top / 60) * HOUR_HEIGHT,
                      height: Math.max(height - 1, 16),
                      left: `calc(${(o.column / o.columns) * 100}% + 1px)`,
                      width: `calc(${100 / o.columns}% - 3px)`,
                    }}
                  >
                    <span
                      className={cn(
                        "flex size-full flex-col rounded-sm px-1.5 transition-colors",
                        compact ? "flex-row items-center gap-1 py-0" : "py-1",
                        EVENT_TYPE_STYLES[o.event.type].chip
                      )}
                    >
                      <span className="block truncate font-semibold">
                        {o.event.title}
                      </span>
                      <span
                        className={cn(
                          "block truncate opacity-80",
                          compact && "shrink-0"
                        )}
                      >
                        {shortTimeLabel(o.start)}
                        {compact ? "" : ` – ${shortTimeLabel(o.end)}`}
                      </span>
                      {!compact && o.event.location && height > 64 ? (
                        <span className="block truncate opacity-70">
                          {o.event.location}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
              {isToday(day) ? (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                  style={{ top: (minutesNow / 60) * HOUR_HEIGHT }}
                  aria-hidden
                >
                  <span className="-ml-1.5 size-3 rounded-full bg-destructive" />
                  <span className="h-0.5 flex-1 bg-destructive" />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

/** Current time, refreshed every minute (for the "now" line). */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}
