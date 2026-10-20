import { cn } from "cn"
import { format, isSameMonth, isToday, setHours } from "date-fns"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { useDateLocale } from "@/lib/i18n"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  daysOf,
  type Occurrence,
  occursOn,
  shortTimeLabel,
} from "./calendar-utils"
import { EVENT_TYPE_STYLES } from "./event-colors"

const MAX_VISIBLE = 3

type Props = {
  date: Date
  range: { start: Date; end: Date }
  occurrences: Occurrence[]
  onSelect: (o: Occurrence) => void
  onCreate: (start: Date) => void
  onOpenDay: (day: Date) => void
}

export function MonthView({
  date,
  range,
  occurrences,
  onSelect,
  onCreate,
  onOpenDay,
}: Props) {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const days = daysOf(range.start, range.end)
  const weeks = Math.ceil(days.length / 7)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b">
        {days.slice(0, 7).map((d) => (
          <div
            key={d.toISOString()}
            className="py-2 text-center text-xs font-medium text-muted-foreground uppercase"
          >
            <span className="hidden sm:inline">
              {format(d, "EEE", { locale })}
            </span>
            <span className="sm:hidden">{format(d, "EEEEE", { locale })}</span>
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7"
        style={{ gridTemplateRows: `repeat(${weeks}, minmax(6.5rem, 1fr))` }}
      >
        {days.map((day) => {
          const items = occurrences.filter((o) => occursOn(o, day))
          const visible = items.slice(0, MAX_VISIBLE)
          const hidden = items.length - visible.length
          const inMonth = isSameMonth(day, date)
          return (
            // biome-ignore lint/a11y/useSemanticElements: a grid cell that contains interactive children
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={-1}
              aria-label={t("calendar.createEventOn", {
                date: format(day, "PPPP", { locale }),
              })}
              onClick={() => onCreate(setHours(day, 9))}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCreate(setHours(day, 9))
              }}
              className={cn(
                "flex min-w-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-r border-b p-1 transition-colors hover:bg-muted/40 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-muted/30 text-muted-foreground"
              )}
            >
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenDay(day)
                  }}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full text-xs font-medium hover:bg-muted",
                    isToday(day) &&
                      "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                  aria-label={format(day, "PPPP", { locale })}
                >
                  {format(day, "d", { locale })}
                </button>
              </div>
              {visible.map((o) => (
                <MonthChip
                  key={o.key}
                  occurrence={o}
                  day={day}
                  onSelect={onSelect}
                />
              ))}
              {hidden > 0 ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="rounded px-1.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {t("calendar.moreCount", { count: hidden })}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-64 p-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mb-2 text-center">
                      <div className="text-xs text-muted-foreground uppercase">
                        {format(day, "EEE", { locale })}
                      </div>
                      <div className="text-xl font-semibold">
                        {format(day, "d", { locale })}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {items.map((o) => (
                        <MonthChip
                          key={o.key}
                          occurrence={o}
                          day={day}
                          onSelect={onSelect}
                        />
                      ))}
                    </div>
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-1 w-full"
                      onClick={() => onOpenDay(day)}
                    >
                      {t("calendar.openDay")}
                    </Button>
                  </PopoverContent>
                </Popover>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthChip({
  occurrence: o,
  day,
  onSelect,
}: {
  occurrence: Occurrence
  day: Date
  onSelect: (o: Occurrence) => void
}) {
  const style = EVENT_TYPE_STYLES[o.event.type]
  const timed = !o.event.allDay && occursOn({ ...o, end: o.start }, day)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onSelect(o)
      }}
      title={o.event.title}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-left text-xs transition-colors",
        timed ? "hover:bg-muted" : style.chip
      )}
    >
      {timed ? (
        <>
          <span
            className={cn("size-2 shrink-0 rounded-full", style.dot)}
            aria-hidden
          />
          <span className="hidden shrink-0 text-muted-foreground tabular-nums md:inline">
            {shortTimeLabel(o.start)}
          </span>
        </>
      ) : null}
      <span className="truncate font-medium">{o.event.title}</span>
    </button>
  )
}
