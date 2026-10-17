import { cn } from "cn"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import type { EventType } from "@app/api/zenstack/models"
import { EVENT_TYPE_STYLES, EVENT_TYPES } from "./event-colors"
import { ScrollArea } from "@/components/ui/scroll-area"

type Props = {
  date: Date
  onDateChange: (d: Date) => void
  types: Set<EventType>
  onTypesChange: (types: Set<EventType>) => void
  mineOnly: boolean
  onMineOnlyChange: (v: boolean) => void
  onCreate: () => void
  className?: string
}

export function CalendarSidebar({
  date,
  onDateChange,
  types,
  onTypesChange,
  mineOnly,
  onMineOnlyChange,
  onCreate,
  className,
}: Props) {
  // browsing the mini calendar doesn't move the main view; picking a day does
  const [month, setMonth] = useState(date)
  const [syncedDate, setSyncedDate] = useState(date)
  if (syncedDate.getTime() !== date.getTime()) {
    setSyncedDate(date)
    setMonth(date)
  }

  return (
    <aside className={cn("flex w-64 shrink-0 flex-col border-r", className)}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          <Button
            className="w-fit rounded-full px-4 shadow-sm"
            size="lg"
            onClick={onCreate}
          >
            <PlusIcon />
            New event
          </Button>
          <Calendar
            mode="single"
            required
            selected={date}
            onSelect={(d) => d && onDateChange(d)}
            month={month}
            onMonthChange={setMonth}
            className="-mx-1 p-0 [--cell-size:--spacing(8)]"
          />
          <Separator />
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Event types
            </h3>
            {EVENT_TYPES.map((type) => {
              const style = EVENT_TYPE_STYLES[type]
              const id = `filter-${type}`
              return (
                <div key={type} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={types.has(type)}
                    className={style.checkbox}
                    onCheckedChange={(checked) => {
                      const next = new Set(types)
                      if (checked) next.add(type)
                      else next.delete(type)
                      onTypesChange(next)
                    }}
                  />
                  <Label htmlFor={id} className="font-normal">
                    {style.label}
                  </Label>
                </div>
              )
            })}
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="mine-only" className="font-normal">
              My events only
            </Label>
            <Switch
              id="mine-only"
              checked={mineOnly}
              onCheckedChange={onMineOnlyChange}
            />
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}
