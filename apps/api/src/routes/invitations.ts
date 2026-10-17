import { Elysia, t } from "elysia";
import { env } from "@/env";
import { db } from "@/lib/db";
import { conflict, forbidden, invalidState, notFound, tooManyRequests } from "@/lib/errors";
import { escapeHtml, sendMail } from "@/lib/mail";
import { rateLimit } from "@/server/rate-limit";
import { authMacro } from "../plugins/auth";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Admin email invites. Sign-up is open, so an invitation is a pointer to `/invite/:id` plus a
 * role granted when that email signs up (see `acceptPendingInvitation`). Writes need the mailer,
 * so they live here instead of `/api/execute`; admins list invitations through `/api/execute`.
 */
export const invitationsRoute = new Elysia({ name: "routes.invitations" })
  .use(authMacro)
  .post(
    "/api/invitations",
    async ({ body, user, set }) => {
      if (user.role !== "admin") throw forbidden("Only admins can invite people");
      if (!rateLimit(`invite:${user.id}`, 30, 60_000)) throw tooManyRequests();
      const email = body.email.trim().toLowerCase();
      const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) throw conflict("This person already has an account");

      // re-inviting replaces the pending invitation
      await db.invitation.updateMany({
        where: { email, status: "PENDING" },
        data: { status: "CANCELED" },
      });
      const invitation = await db.invitation.create({
        data: {
          email,
          role: body.role ?? "user",
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedById: user.id,
        },
      });

      const url = `${env.APP_URL}/invite/${invitation.id}`;
      await sendMail({
        to: email,
        subject: `${user.name} invited you to cworkplace`,
        // names are user-controlled: escape them before putting them in HTML
        html: `<p>${escapeHtml(user.name)} invited you to join cworkplace.</p><p><a href="${url}">Accept invitation</a></p>`,
        text: `${user.name} invited you to join cworkplace: ${url}`,
      });
      set.status = 201;
      return { data: invitation };
    },
    {
      auth: true,
      body: t.Object({
        email: t.String({ format: "email", maxLength: 254 }),
        role: t.Optional(t.Union([t.Literal("user"), t.Literal("admin")])),
      }),
      detail: { tags: ["Admin"], summary: "Invite someone by email" },
    },
  )
  .post(
    "/api/invitations/:id/cancel",
    async ({ params, user }) => {
      if (user.role !== "admin") throw forbidden("Only admins can cancel invitations");
      const invitation = await db.invitation.findUnique({ where: { id: params.id } });
      if (!invitation) throw notFound("Invitation not found");
      if (invitation.status !== "PENDING") throw invalidState("Invitation is no longer pending");
      const updated = await db.invitation.update({
        where: { id: params.id },
        data: { status: "CANCELED" },
      });
      return { data: updated };
    },
    {
      auth: true,
      params: t.Object({ id: t.String({ minLength: 1, maxLength: 64 }) }),
      detail: { tags: ["Admin"], summary: "Cancel a pending invitation" },
    },
  )
  // public: the invite page is reachable before the invitee has an account
  .get(
    "/api/invitations/:id",
    async ({ params }) => {
      const invitation = await db.invitation.findUnique({
        where: { id: params.id },
        select: {
          email: true,
          status: true,
          expiresAt: true,
          invitedBy: { select: { name: true } },
        },
      });
      if (!invitation) throw notFound("Invitation not found");
      return {
        data: {
          email: invitation.email,
          inviterName: invitation.invitedBy.name,
          status: invitation.status,
          expired: invitation.expiresAt.getTime() < Date.now(),
        },
      };
    },
    {
      params: t.Object({ id: t.String({ minLength: 1, maxLength: 64 }) }),
      detail: { tags: ["Admin"], summary: "Public details of an invitation" },
    },
  );
