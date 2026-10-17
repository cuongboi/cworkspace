import { db } from "@/lib/db";
import { notify } from "@/server/notify";

/**
 * In-process reminder worker: EVENT_REMINDER notifications ~10 minutes before an event starts.
 * Started once at boot (`src/index.ts`). Recurring events are reminded for their first
 * occurrence only. Move to a real job queue when running more than one instance.
 */

const LEAD_MS = 10 * 60_000;
const TICK_MS = 60_000;

let timer: ReturnType<typeof setInterval> | undefined;

async function tick() {
  const now = new Date();
  const due = await db.event.findMany({
    where: {
      remindedAt: null,
      type: { in: ["MEETING", "EVENT"] },
      startAt: { gt: now, lte: new Date(now.getTime() + LEAD_MS) },
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      creatorId: true,
      attendees: {
        where: { rsvp: { not: "DECLINED" } },
        select: { userId: true },
      },
    },
    take: 200,
  });
  for (const event of due) {
    // claim first so a slow tick never double-notifies
    const { count } = await db.event.updateMany({
      where: { id: event.id, remindedAt: null },
      data: { remindedAt: now },
    });
    if (count === 0) continue;
    const userIds = new Set([event.creatorId, ...event.attendees.map((a) => a.userId)]);
    await notify(
      [...userIds].map((userId) => ({
        userId,
        type: "EVENT_REMINDER" as const,
        eventId: event.id,
        data: { title: event.title, startAt: event.startAt.toISOString() },
      })),
    );
  }
}

export function startReminderWorker() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => console.error("[reminders]", err));
  }, TICK_MS);
  timer.unref?.();
}
