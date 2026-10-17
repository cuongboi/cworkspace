import { db } from "@/lib/db";

/** Slug of the org-wide group every member belongs to. */
export const DEFAULT_GROUP_SLUG = "all-company";

/** Creates the org's "All company" group with the creator as admin. Idempotent. */
export async function createDefaultGroup(organizationId: string, ownerId: string) {
  const existing = await db.group.findFirst({
    where: { organizationId, isDefault: true },
  });
  if (existing) return existing;
  return db.group.create({
    data: {
      organizationId,
      name: "All company",
      slug: DEFAULT_GROUP_SLUG,
      description: "Everyone in the organization.",
      privacy: "PUBLIC",
      isDefault: true,
      createdById: ownerId,
      members: { create: { userId: ownerId, role: "ADMIN" } },
    },
  });
}

/** Adds a new org member to the "All company" group. */
export async function joinDefaultGroup(organizationId: string, userId: string) {
  const group = await db.group.findFirst({
    where: { organizationId, isDefault: true },
  });
  if (!group) return;
  await db.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId } },
    create: { groupId: group.id, userId },
    update: { status: "ACTIVE" },
  });
}

/** Removes a former member's group and conversation memberships in that org. */
export async function removeFromOrganization(organizationId: string, userId: string) {
  await db.groupMember.deleteMany({
    where: { userId, group: { organizationId } },
  });
  await db.conversationMember.deleteMany({
    where: { userId, conversation: { organizationId } },
  });
  await db.eventAttendee.deleteMany({
    where: { userId, event: { organizationId } },
  });
}
