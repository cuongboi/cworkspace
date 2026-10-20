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
