import { cn } from "cn"
import { EyeOffIcon, GlobeIcon, LockIcon } from "lucide-react"
import type { GroupPrivacy } from "@app/api/zenstack/models"
import { accentFor } from "@/lib/accent"
import { PRIVACY_LABEL } from "./group-query"

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
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <PrivacyIcon privacy={privacy} className="size-3.5" />
      {PRIVACY_LABEL[privacy]}
    </span>
  )
}

/** Cover image, or a tinted banner with the group's initial. */
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
  return (
    <div
      aria-hidden
      className={cn(
        "flex w-full items-center justify-center font-semibold text-white",
        className
      )}
      style={{ backgroundColor: accentFor(group.id ?? group.name) }}
    >
      <span className="text-4xl">{group.name[0]?.toUpperCase()}</span>
    </div>
  )
}
