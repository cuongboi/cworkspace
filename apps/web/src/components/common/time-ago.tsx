import { format, formatDistanceStrict, isToday, isYesterday } from "date-fns"
import { useNow } from "@/hooks/use-now"

/** Relative time ("5m", "2h") with the full date in the tooltip. */
export function TimeAgo({
  date,
  className,
}: {
  date: Date | string
  className?: string
}) {
  const d = typeof date === "string" ? new Date(date) : date
  const now = useNow()
  const ageMs = now - d.getTime()
  const label =
    ageMs < 45_000
      ? "just now"
      : ageMs < 7 * 86_400_000
        ? formatDistanceStrict(d, now, { addSuffix: true })
        : format(d, "MMM d, yyyy")
  return (
    <time
      dateTime={d.toISOString()}
      title={format(d, "PPpp")}
      className={className}
      suppressHydrationWarning
    >
      {label}
    </time>
  )
}

/** Short time for chat lists: "14:05", "Yesterday", "Mar 3". */
export function shortTime(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date
  if (isToday(d)) return format(d, "HH:mm")
  if (isYesterday(d)) return "Yesterday"
  return format(d, "MMM d")
}
