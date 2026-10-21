import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { admin, bearer, jwt, openAPI } from "better-auth/plugins";
import { SOCIAL_PROVIDERS } from "@app/shared/app-config";
import { env } from "@/env";
import { acceptPendingInvitation, ensureAdmin, joinDefaultGroup } from "@/server/company";
import { signUpAllowed } from "@/server/onboarding";
import { getSecret, getSettings, onSettingsChange } from "@/server/settings";
import { db, dbAdapter } from "./db";
import { sendMail } from "./mail";

/** Set by the auth route from the socket / trusted proxy (`plugins/auth.ts`); never client-controlled. */
export const CLIENT_IP_HEADER = "x-client-ip";

/** Enabled providers from Settings → Sign-in (only those with a client id and secret). */
function socialProviders(): BetterAuthOptions["socialProviders"] {
  const { social, app } = getSettings();
  return Object.fromEntries(
    SOCIAL_PROVIDERS.filter((p) => app.socialProviders.includes(p)).map((p) => [
      p,
      { clientId: social[p]!.clientId, clientSecret: getSecret(`${p}ClientSecret`) },
    ]),
  );
}

const createAuth = () =>
  betterAuth({
    database: dbAdapter,
    socialProviders: socialProviders(),
    baseURL: env.BETTER_AUTH_URL,
    basePath: env.BETTER_AUTH_BASE_PATH,
    plugins: [
      jwt({
        jwks: { jwksPath: "/.well-known/jwks.json" },
        jwt: { expirationTime: "30d" },
      }),
      admin(),
      bearer(),
      openAPI(),
    ],
    trustedOrigins: env.WEB_ORIGIN.split(","),
    // Session rows record this IP; the account page lists it next to the user agent.
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      useSecureCookies: env.BETTER_AUTH_URL.startsWith("https"),
    },
    // explicit (better-auth only enables it in production by default); in-memory per process
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/forget-password": { window: 300, max: 3 },
      },
    },
    session: {
      // Sliding idle timeout: each request within updateAge extends the session by expiresIn.
      expiresIn: 60 * 60,
      updateAge: 60,
      // A revoked session keeps working on its device until this cache expires (≤ 60s).
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
            // a fresh instance: the first account comes from onboarding (setup token)
            if (!signUpAllowed())
              throw new APIError("FORBIDDEN", { message: "This workspace isn't set up yet" });
            const count = await db.user.count();
            return { data: { ...user, role: count === 0 ? "admin" : (user.role ?? "user") } };
          },
          after: async (user) => {
            // the role set above can lose to the admin plugin's default; this one can't
            await ensureAdmin();
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

/**
 * better-auth fixes its social providers when it is built, so the instance is rebuilt when an
 * admin changes them (a live binding: importers always see the current one).
 */
let socialKey = JSON.stringify(socialProviders());
export let auth = createAuth();

onSettingsChange(() => {
  const key = JSON.stringify(socialProviders());
  if (key === socialKey) return;
  socialKey = key;
  auth = createAuth();
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session["user"];
