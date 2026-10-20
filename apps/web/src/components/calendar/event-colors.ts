import {
  BellIcon,
  CalendarDaysIcon,
  type LucideIcon,
  PlaneIcon,
  UsersIcon,
} from "lucide-react"
import type { EventType } from "@app/api/zenstack/models"

export type EventTypeStyle = {
  icon: LucideIcon
  /** filled chip used inside the grids (time grid blocks, month chips) */
  chip: string
  /** small solid dot (agenda, legends, filters) */
  dot: string
  /** checkbox accent for the filter list */
  checkbox: string
}

/** Label key: resolve with `t(eventTypeLabelKey(type))`. */
export const eventTypeLabelKey = (type: EventType) =>
  `calendar.types.${type}` as const

/** The one place that maps an event type to its colors. Theme friendly (light + dark). */
export const EVENT_TYPE_STYLES: Record<EventType, EventTypeStyle> = {
  MEETING: {
    icon: UsersIcon,
    chip: "bg-blue-500/15 text-blue-800 dark:text-blue-200 border-l-2 border-blue-500 hover:bg-blue-500/25",
    dot: "bg-blue-500!",
    checkbox:
      "data-[state=checked]:border-blue-500! data-[state=checked]:bg-blue-500! dark:data-[state=checked]:border-blue-500! dark:data-[state=checked]:bg-blue-500!",
  },
  EVENT: {
    icon: CalendarDaysIcon,
    chip: "bg-violet-500/15 text-violet-800 dark:text-violet-200 border-l-2 border-violet-500 hover:bg-violet-500/25",
    dot: "bg-violet-500!",
    checkbox:
      "data-[state=checked]:border-violet-500! data-[state=checked]:bg-violet-500! dark:data-[state=checked]:border-violet-500! dark:data-[state=checked]:bg-violet-500!",
  },
  OUT_OF_OFFICE: {
    icon: PlaneIcon,
    chip: "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-l-2 border-amber-500 hover:bg-amber-500/25",
    dot: "bg-amber-500!",
    checkbox:
      "data-[state=checked]:border-amber-500! data-[state=checked]:bg-amber-500! dark:data-[state=checked]:border-amber-500! dark:data-[state=checked]:bg-amber-500!",
  },
  REMINDER: {
    icon: BellIcon,
    chip: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-l-2 border-emerald-500 hover:bg-emerald-500/25",
    dot: "bg-emerald-500!",
    checkbox:
      "data-[state=checked]:border-emerald-500! data-[state=checked]:bg-emerald-500! dark:data-[state=checked]:border-emerald-500! dark:data-[state=checked]:bg-emerald-500!",
  },
}

export const EVENT_TYPES = Object.keys(EVENT_TYPE_STYLES) as EventType[]
