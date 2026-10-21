import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { db } from "@/lib/db";

/**
 * First run: while the instance has no user, the first account is made through the onboarding
 * page, which proves access to the server with a setup token (printed to the console at boot,
 * or `ONBOARDING_TOKEN`). Until then ordinary sign-up (email or social) is refused, so nobody
 * who merely finds a fresh deployment can become its admin.
 *
 * State is in memory: one API process (see AGENTS.md); a restart while still empty prints a
 * new token.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** null once the instance has a user (sticky: users are never all deleted while running) */
let tokenHash: Buffer | null = null;
let required = false;
/** set while the onboarding route creates the first account, so the sign-up gate lets it pass */
let creatingFirstUser = false;
let lock: Promise<unknown> = Promise.resolve();

/** At boot: decides whether onboarding is needed and, if so, prints the setup link. */
export async function initOnboarding() {
  required = (await db.user.count()) === 0;
  if (!required) return;
  const token =
    env.ONBOARDING_TOKEN ||
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  tokenHash = sha256(token);
  const link = `${env.APP_URL.replace(/\/$/, "")}/onboarding#token=${encodeURIComponent(token)}`;
  console.log(
    env.ONBOARDING_TOKEN
      ? `\n🔐 No users yet. Finish setup at ${env.APP_URL}/onboarding with ONBOARDING_TOKEN.\n`
      : `\n🔐 No users yet. Finish setup (link valid until restart):\n   ${link}\n`,
  );
}

export const onboardingRequired = () => required;

/** Constant-time comparison against the setup token. */
export function checkSetupToken(token: string | undefined): boolean {
  if (!tokenHash || !token || token.length > 512) return false;
  return timingSafeEqual(sha256(token), tokenHash);
}

/**
 * Runs `create` once, serialized: concurrent requests wait for each other and see the instance
 * already set up. Returns null when it was (409).
 */
export async function withFirstUser<T>(create: () => Promise<T>): Promise<T | null> {
  const run = lock.then(async () => {
    if (!required || (await db.user.count()) > 0) {
      required = false;
      return null;
    }
    creatingFirstUser = true;
    try {
      const result = await create();
      required = false;
      tokenHash = null;
      return result;
    } finally {
      creatingFirstUser = false;
    }
  });
  lock = run.catch(() => undefined);
  return run;
}

/** Sign-up gate (better-auth `user.create.before`): no ordinary first account. */
export function signUpAllowed() {
  return !required || creatingFirstUser;
}
