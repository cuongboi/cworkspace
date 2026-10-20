import { format, formatDistanceStrict, isToday, isYesterday } from "date-fns"
import { useTranslation } from "react-i18next"
import { useNow } from "@/hooks/use-now"
import i18n, { dateLocale, useDateLocale } from "@/lib/i18n"

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
  const { t } = useTranslation()
  const locale = useDateLocale()
  const ageMs = now - d.getTime()
  const label =
    ageMs < 45_000
      ? t("common.justNow")
      : ageMs < 7 * 86_400_000
        ? formatDistanceStrict(d, now, { addSuffix: true, locale })
        : format(d, t("feed.dateFormat.fullDate"), { locale })
  return (
    <time
      dateTime={d.toISOString()}
      title={format(d, "PPpp", { locale })}
      className={className}
      suppressHydrationWarning
    >
      {label}
    </time>
  )
}

/** Short time for chat lists: "14:05", "Yesterday", "Mar 3" (non-hook, current language). */
export function shortTime(date: Date | string) {
  const d = typeof date === "string" ? new Date(date) : date
  if (isToday(d)) return format(d, "HH:mm")
  if (isYesterday(d)) return i18n.t("feed.yesterday")
  return format(d, i18n.t("feed.dateFormat.monthDay"), { locale: dateLocale() })
}
