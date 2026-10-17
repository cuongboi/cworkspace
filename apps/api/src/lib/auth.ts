import { betterAuth } from "better-auth";
import { admin, bearer, jwt, openAPI } from "better-auth/plugins";
import { env } from "@/env";
import { acceptPendingInvitation, joinDefaultGroup } from "@/server/company";
import { db, dbAdapter } from "./db";
import { sendMail } from "./mail";

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
  ],
  trustedOrigins: env.WEB_ORIGIN.split(","),
  session: {
    // Sliding idle timeout: each request within updateAge extends the session by expiresIn.
    expiresIn: 60 * 60,
    updateAge: 60,
    cookieCache: { enabled: true, strategy: "jwt", maxAge: 60 },
  },
  user: {
    // Exposed on the session so `dbFor` can bind it to `auth().permissions` without a lookup.
    additionalFields: {
      permissions: { type: "json", required: false, input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Open sign-up: the very first account administers the instance.
        before: async (user) => {
          const count = await db.user.count();
          return { data: { ...user, role: count === 0 ? "admin" : (user.role ?? "user") } };
        },
        after: async (user) => {
          await joinDefaultGroup(user.id);
          await acceptPendingInvitation(user);
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
