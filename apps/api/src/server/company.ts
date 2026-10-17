import { db } from "@/lib/db";

/** Slug of the company-wide group every user belongs to. */
export const DEFAULT_GROUP_SLUG = "all-company";

/**
 * Adds a new user to the "All company" group. The group's `createdById` is required, so the first
 * user to sign up creates it (as its admin) instead of a startup seed.
 */
export async function joinDefaultGroup(userId: string) {
  const group = await db.group.findFirst({ where: { isDefault: true } });
  if (!group) {
    await db.group.create({
      data: {
        name: "All company",
        slug: DEFAULT_GROUP_SLUG,
        description: "Everyone in the company.",
        privacy: "PUBLIC",
        isDefault: true,
        createdById: userId,
        members: { create: { userId, role: "ADMIN" } },
      },
    });
    return;
  }
  await db.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId } },
    create: { groupId: group.id, userId },
    update: { status: "ACTIVE" },
  });
}

/**
 * Applies a pending invitation on sign-up: grants its role and marks it accepted.
 * Sign-up is open, so a missing invitation is not an error.
 */
export async function acceptPendingInvitation(user: { id: string; email: string }) {
  const invitation = await db.invitation.findFirst({
    where: { email: user.email.toLowerCase(), status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!invitation) return;
  await db.$transaction(async (tx) => {
    if (invitation.role === "admin") {
      await tx.user.update({ where: { id: user.id }, data: { role: "admin" } });
    }
    await tx.invitation.updateMany({
      where: { email: invitation.email, status: "PENDING" },
      data: { status: "ACCEPTED" },
    });
  });
}
