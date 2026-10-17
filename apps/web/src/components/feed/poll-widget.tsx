import { cn } from "cn"
import { format } from "date-fns"
import {
  CheckCircle2Icon,
  CircleIcon,
  SquareCheckIcon,
  SquareIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useNow } from "@/hooks/use-now"
import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { useDbMutation } from "@/lib/query"
import type { FeedPost } from "./post-query"

type PollData = NonNullable<FeedPost["poll"]>

/** Live poll results; click an option to vote (single choice switches, multiple toggles). */
export function PollWidget({ poll }: { poll: PollData }) {
  const { me } = useOrg()
  const serverMine = poll.votes
    .filter((v) => v.userId === me.id)
    .map((v) => v.optionId)
  // optimistic selection while a vote is in flight
  const [pending, setPending] = useState<string[] | null>(null)
  const mine = pending ?? serverMine
  const now = useNow()
  const closed = poll.closesAt ? poll.closesAt.getTime() <= now : false

  const counts = new Map(
    poll.options.map((o) => {
      const base = o._count.votes
      if (!pending) return [o.id, base]
      const had = serverMine.includes(o.id)
      const has = pending.includes(o.id)
      return [o.id, base + (has && !had ? 1 : 0) - (had && !has ? 1 : 0)]
    })
  )
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const voters = new Set(poll.votes.map((v) => v.userId))
  if (pending?.length) voters.add(me.id)
  else if (pending) voters.delete(me.id)

  const vote = useDbMutation(
    async (optionId: string) => {
      const has = serverMine.includes(optionId)
      if (poll.allowMultiple) {
        if (has) {
          await db.pollVote.delete({
            where: { optionId_userId: { optionId, userId: me.id } },
          })
        } else {
          await db.pollVote.create({ data: { pollId: poll.id, optionId } })
        }
        return
      }
      // single choice: remove my vote first, then cast the new one (unless un-voting)
      if (serverMine.length) {
        await db.pollVote.deleteMany({
          where: { pollId: poll.id, userId: me.id },
        })
      }
      if (!has)
        await db.pollVote.create({ data: { pollId: poll.id, optionId } })
    },
    { invalidates: ["pollVote", "poll", "post"] }
  )

  const onVote = (optionId: string) => {
    if (closed || vote.isPending) return
    const has = mine.includes(optionId)
    setPending(
      poll.allowMultiple
        ? has
          ? mine.filter((id) => id !== optionId)
          : [...mine, optionId]
        : has
          ? []
          : [optionId]
    )
    vote.mutate(optionId, {
      onError: (err) => toast.error(err.message),
      onSettled: () => setPending(null),
    })
  }

  const Selected = poll.allowMultiple ? SquareCheckIcon : CheckCircle2Icon
  const Unselected = poll.allowMultiple ? SquareIcon : CircleIcon

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <div>
        <p className="font-semibold">{poll.question}</p>
        <p className="text-xs text-muted-foreground">
          {poll.allowMultiple ? "Choose one or more" : "Choose one"} ·{" "}
          {voters.size} {voters.size === 1 ? "person" : "people"} voted
          {poll.closesAt
            ? closed
              ? ` · Closed ${format(poll.closesAt, "MMM d, HH:mm")}`
              : ` · Closes ${format(poll.closesAt, "MMM d, HH:mm")}`
            : ""}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {poll.options.map((o) => {
          const count = counts.get(o.id) ?? 0
          const pct = total ? Math.round((count / total) * 100) : 0
          const selected = mine.includes(o.id)
          return (
            <li key={o.id}>
              <button
                type="button"
                disabled={closed}
                aria-pressed={selected}
                onClick={() => onVote(o.id)}
                className={cn(
                  "relative flex w-full items-center gap-2 overflow-hidden rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors",
                  !closed &&
                    "hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected && "border-primary",
                  closed && "cursor-default"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-0 left-0 transition-[width] duration-300",
                    selected ? "bg-primary/15" : "bg-muted"
                  )}
                  style={{ width: `${pct}%` }}
                />
                <span className="relative flex min-w-0 flex-1 items-center gap-2">
                  {closed ? null : selected ? (
                    <Selected className="size-4 shrink-0 text-primary" />
                  ) : (
                    <Unselected className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={cn("truncate", selected && "font-medium")}>
                    {o.text}
                  </span>
                </span>
                <span className="relative shrink-0 text-xs text-muted-foreground tabular-nums">
                  {pct}% · {count}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
