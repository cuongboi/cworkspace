import type { GroupGetPayload, GroupInclude } from "@app/api/zenstack/input"
import type { GroupRole, MembershipStatus } from "@app/api/zenstack/models"

/** Shared shape of a group in lists and on the group page: active member count + my membership. */
export function groupInclude(meId: string) {
  return {
    _count: { select: { members: { where: { status: "ACTIVE" } } } },
    members: {
      where: { userId: meId },
      select: { role: true, status: true },
    },
    createdBy: { select: { id: true, name: true } },
  } as const satisfies GroupInclude
}

export type GroupWithMe = GroupGetPayload<{
  include: ReturnType<typeof groupInclude>
}>

export type MyMembership =
  { role: GroupRole; status: MembershipStatus } | undefined

export const PRIVACY_LABEL = {
  PUBLIC: "Public group",
  CLOSED: "Closed group",
  SECRET: "Secret group",
} as const

export const PRIVACY_DESCRIPTION = {
  PUBLIC: "Anyone in the company can see posts and join.",
  CLOSED:
    "Anyone can find the group and see who's in it. Only members see posts; joining needs approval.",
  SECRET:
    "Only members can find the group and see posts. Members are added by admins.",
} as const
