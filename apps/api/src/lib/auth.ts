import { betterAuth } from "better-auth";
import { admin, bearer, jwt, openAPI, organization } from "better-auth/plugins";
import { env } from "@/env";
import { createDefaultGroup, joinDefaultGroup, removeFromOrganization } from "@/server/org";
import { db, dbAdapter } from "./db";
import { escapeHtml, sendMail } from "./mail";

export const auth = betterAuth({
  database: dbAdapter,
  baseURL: env.BETTER_AUTH_URL,
  basePath: env.BETTER_AUTH_BASE_PATH,
  plugins: [
    jwt({
      jwks: { jwksPath: "/.well-known/jwks.json" },
      jwt: { expirationTime: "15m" },
    }),
    admin(),
    bearer(),
    openAPI(),
    // Tenants. Mutate orgs, members and invitations only through `authClient.organization.*`.
    organization({
      sendInvitationEmail: async ({ id, email, organization, inviter }) => {
        const url = `${env.APP_URL}/invite/${id}`;
        await sendMail({
          to: email,
          subject: `${inviter.user.name} invited you to ${organization.name} on cworkplace`,
          // Names are user-controlled: escape them before putting them in HTML.
          html: `<p>${escapeHtml(inviter.user.name)} invited you to join <b>${escapeHtml(organization.name)}</b>.</p><p><a href="${url}">Accept invitation</a></p>`,
          text: `${inviter.user.name} invited you to join ${organization.name}: ${url}`,
        });
      },
      organizationHooks: {
        afterCreateOrganization: async ({ organization, user }) => {
          await createDefaultGroup(organization.id, user.id);
        },
        afterAddMember: async ({ organization, user }) => {
          await joinDefaultGroup(organization.id, user.id);
        },
        afterAcceptInvitation: async ({ organization, user }) => {
          await joinDefaultGroup(organization.id, user.id);
        },
        afterRemoveMember: async ({ organization, user }) => {
          await removeFromOrganization(organization.id, user.id);
        },
      },
    }),
  ],
  trustedOrigins: env.WEB_ORIGIN.split(","),
  session: {
    // Sliding idle timeout: each request within updateAge extends the session by expiresIn.
    expiresIn: 60 * 60,
    updateAge: 60,
    cookieCache: { enabled: true, strategy: "jwt", maxAge: 60 },
  },
  databaseHooks: {
    session: {
      create: {
        // Land new sessions in the user's first organization so `/` can redirect to `/:orgSlug`.
        before: async (session) => {
          const member = await db.member.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: "asc" },
            select: { organizationId: true },
          });
          return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } };
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 6,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Reset your cworkplace password",
        html: `<p><a href="${url}">Reset your password</a></p>`,
        text: `Reset your password: ${url}`,
      });
    },
  },
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session["user"];
