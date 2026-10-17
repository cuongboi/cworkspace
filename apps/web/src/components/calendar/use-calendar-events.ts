import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import { type CalendarEvent, eventInclude } from "./calendar-utils"

const PAGE = 100

/**
 * Events visible to me (policies decide) that may have an occurrence in [start, end];
 * `groupId` narrows it to one group's calendar.
 */
export function useCalendarEvents(
  start: Date,
  end: Date,
  { groupId }: { groupId?: string } = {}
) {
  const { org } = useOrg()
  return useDbQuery(
    [
      "event",
      "findMany",
      "calendar",
      org.id,
      groupId ?? "all",
      start.getTime(),
      end.getTime(),
    ],
    async () => {
      // the API caps a page at 100 rows: walk the cursor (bounded) for busy calendars
      const all: CalendarEvent[] = []
      for (let page = 0; page < 10; page++) {
        const cursor = all.at(-1)?.id
        const rows = await db.event.findMany({
          where: {
            organizationId: org.id,
            ...(groupId ? { groupId } : {}),
            startAt: { lt: end },
            OR: [{ endAt: { gte: start } }, { rrule: { not: null } }],
          },
          include: eventInclude,
          orderBy: [{ startAt: "asc" }, { id: "asc" }],
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
        all.push(...rows)
        if (rows.length < PAGE) break
      }
      return all
    },
    { placeholderData: (prev) => prev }
  )
}

/** A single event (details sheet, deep links). */
export function useCalendarEvent(id: string | null) {
  return useDbQuery(
    ["event", "findUnique", id],
    () =>
      db.event.findUnique({ where: { id: id ?? "" }, include: eventInclude }),
    { enabled: Boolean(id) }
  )
}
