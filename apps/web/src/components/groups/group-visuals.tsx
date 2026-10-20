import { cn } from "cn"
import { EyeOffIcon, GlobeIcon, LockIcon } from "lucide-react"
import type { GroupPrivacy } from "@app/api/zenstack/models"
import { useTranslation } from "react-i18next"
import { accentFor } from "@/lib/accent"

export function PrivacyIcon({
  privacy,
  className,
}: {
  privacy: GroupPrivacy
  className?: string
}) {
  const Icon =
    privacy === "PUBLIC"
      ? GlobeIcon
      : privacy === "CLOSED"
        ? LockIcon
        : EyeOffIcon
  return <Icon className={className} aria-hidden />
}

export function PrivacyLabel({
  privacy,
  className,
}: {
  privacy: GroupPrivacy
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <PrivacyIcon privacy={privacy} className="size-3.5" />
      {t(`groups.privacyGroup.${privacy}`)}
    </span>
  )
}

/** Small rounded pill: privacy at a glance (translated). */
export function PrivacyBadge({ privacy }: { privacy: GroupPrivacy }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-semibold",
        privacy === "PUBLIC"
          ? "bg-brand-subtle text-brand"
          : privacy === "CLOSED"
            ? "bg-warning-subtle text-warning"
            : "bg-muted text-muted-foreground"
      )}
    >
      <PrivacyIcon privacy={privacy} className="size-3" />
      {t(`groups.privacy.${privacy}`)}
    </span>
  )
}

/** Cover image, or a soft accent gradient (the group's avatar carries its initial). */
export function GroupCover({
  group,
  className,
}: {
  group: { id?: string; name: string; coverUrl: string | null }
  className?: string
}) {
  if (group.coverUrl) {
    return (
      // biome-ignore lint/performance/noImgElement: authenticated file URLs can't go through next/image
      <img
        src={group.coverUrl}
        alt=""
        className={cn("w-full bg-muted object-cover", className)}
      />
    )
  }
  const accent = accentFor(group.id ?? group.name)
  return (
    <div
      aria-hidden
      className={cn("w-full", className)}
      style={{
        backgroundColor: `color-mix(in oklab, ${accent} 22%, var(--card))`,
        backgroundImage: `radial-gradient(circle at 1px 1px, color-mix(in oklab, ${accent} 45%, transparent) 1.5px, transparent 0), linear-gradient(120deg, color-mix(in oklab, ${accent} 30%, transparent), transparent 70%)`,
        backgroundSize: "18px 18px, 100% 100%",
      }}
    />
  )
}

/** Square group mark: the cover image, or the initial on the group's accent. */
export function GroupAvatar({
  group,
  className,
}: {
  group: { id?: string; name: string; coverUrl: string | null }
  className?: string
}) {
  if (group.coverUrl) {
    return (
      <img
        src={group.coverUrl}
        alt=""
        className={cn("size-10 shrink-0 rounded-2xl object-cover", className)}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-2xl font-bold text-white",
        className
      )}
      style={{ backgroundColor: accentFor(group.id ?? group.name) }}
    >
      {group.name[0]?.toUpperCase()}
    </span>
  )
}
