import { cn } from "cn"
import { format, isToday } from "date-fns"
import { CalendarXIcon, MapPinIcon, RepeatIcon, VideoIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  daysOf,
  type Occurrence,
  occursOn,
  shortTimeLabel,
} from "./calendar-utils"
import { EVENT_TYPE_STYLES } from "./event-colors"
import { ScrollArea } from "@/components/ui/scroll-area"

type Props = {
  range: { start: Date; end: Date }
  occurrences: Occurrence[]
  onSelect: (o: Occurrence) => void
  onCreate: () => void
}

export function AgendaView({ range, occurrences, onSelect, onCreate }: Props) {
  const groups = daysOf(range.start, range.end)
    .map((day) => ({ day, items: occurrences.filter((o) => occursOn(o, day)) }))
    .filter((g) => g.items.length > 0)

  if (groups.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarXIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing scheduled</EmptyTitle>
          <EmptyDescription>
            No events between {format(range.start, "MMM d")} and{" "}
            {format(range.end, "MMM d")}.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreate}>New event</Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ol className="mx-auto flex max-w-3xl flex-col divide-y px-2 sm:px-4">
        {groups.map(({ day, items }) => (
          <li key={day.toISOString()} className="flex gap-3 py-3 sm:gap-6">
            <div className="flex w-14 shrink-0 flex-col items-center sm:w-20 sm:flex-row sm:items-start sm:gap-2">
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-lg font-semibold",
                  isToday(day) && "bg-primary text-primary-foreground"
                )}
              >
                {format(day, "d")}
              </span>
              <span className="text-xs text-muted-foreground uppercase sm:pt-2.5">
                {format(day, "MMM, EEE")}
              </span>
            </div>
            <ul className="flex min-w-0 flex-1 flex-col gap-1">
              {items.map((o) => {
                const style = EVENT_TYPE_STYLES[o.event.type]
                const Icon = style.icon
                return (
                  <li key={o.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(o)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
                    >
                      <span
                        className={cn(
                          "size-2.5 shrink-0 rounded-full",
                          style.dot
                        )}
                        aria-hidden
                      />
                      <span className="w-28 shrink-0 text-sm text-muted-foreground tabular-nums">
                        {o.event.allDay
                          ? "All day"
                          : `${shortTimeLabel(o.start)} – ${shortTimeLabel(o.end)}`}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1.5 truncate font-medium">
                          {o.event.title}
                          {o.event.rrule ? (
                            <RepeatIcon
                              className="size-3.5 text-muted-foreground"
                              aria-label="Repeats"
                            />
                          ) : null}
                          {o.event.hasVideoCall ? (
                            <VideoIcon
                              className="size-3.5 text-muted-foreground"
                              aria-label="Video call"
                            />
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Icon className="size-3" />
                            {style.label}
                          </span>
                          {o.event.location ? (
                            <span className="inline-flex min-w-0 items-center gap-1 truncate">
                              <MapPinIcon className="size-3 shrink-0" />
                              {o.event.location}
                            </span>
                          ) : null}
                          {o.event.group ? (
                            <span className="truncate">
                              · {o.event.group.name}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ol>
    </ScrollArea>
  )
}
