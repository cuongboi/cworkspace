import { Elysia, t } from "elysia";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { badRequest, conflict, forbidden, tooManyRequests } from "@/lib/errors";
import { clientIp } from "@/lib/ip";
import { escapeHtml, sendMail } from "@/lib/mail";
import { checkSetupToken, onboardingRequired, withFirstUser } from "@/server/onboarding";
import { rateLimit } from "@/server/rate-limit";
import { CAPTION_PROVIDERS, checkSettings, getSettings, updateSettings } from "@/server/settings";
import { emitToRoom, rooms } from "@/websocket/hub";

const MIN_PASSWORD = 8;

const opt = (max: number) => t.Optional(t.String({ maxLength: max }));

const bodySchema = t.Object(
  {
    name: t.String({ minLength: 1, maxLength: 100 }),
    email: t.String({ format: "email", maxLength: 254 }),
    password: t.String({ minLength: MIN_PASSWORD, maxLength: 128 }),
    settings: t.Object(
      {
        branding: t.Optional(
          t.Object({ name: opt(60), description: opt(300) }, { additionalProperties: false }),
        ),
        captions: t.Optional(
          t.Object(
            { provider: t.Optional(t.UnionEnum(CAPTION_PROVIDERS)), apiKey: opt(4096) },
            { additionalProperties: false },
          ),
        ),
        email: t.Optional(
          t.Object({ from: opt(200), resendApiKey: opt(4096) }, { additionalProperties: false }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

/**
 * Browsers send `Origin` on every fetch POST: anything else is not our setup page.
 * `Sec-Fetch-Site` can't be set by scripts and holds behind a dev proxy or a `*` WEB_ORIGIN,
 * where the browser-facing origin isn't in the env.
 */
function sameOrigin(origin: string | null, fetchSite: string | null) {
  if (!origin) return false;
  if (fetchSite === "same-origin") return true;
  const allowed = [...env.WEB_ORIGIN.split(","), env.BETTER_AUTH_URL, env.APP_URL].map((o) => {
    try {
      return new URL(o.trim()).origin;
    } catch {
      return o.trim();
    }
  });
  return allowed.includes(origin);
}

/**
 * First-run setup (see `server/onboarding.ts`):
 *   GET  /api/onboarding  → { required }   (public; never says more)
 *   POST /api/onboarding  → creates the admin (signed in by the response) and first settings.
 *     Requires `x-setup-token`, a same-origin request, and an instance without users.
 */
export const onboardingRoute = new Elysia({ name: "routes.onboarding" })
  .get(
    "/api/onboarding",
    ({ set }) => {
      set.headers["cache-control"] = "no-store";
      return { data: { required: onboardingRequired() } };
    },
    { detail: { tags: ["Onboarding"], summary: "Whether the instance still needs setting up" } },
  )
  .post(
    "/api/onboarding",
    async (ctx) => {
      const { body, request } = ctx;
      const ip = clientIp(ctx) ?? "unknown";
      if (!rateLimit(`onboarding:${ip}`, 5, 15 * 60_000))
        throw tooManyRequests("Too many attempts");
      if (!sameOrigin(request.headers.get("origin"), request.headers.get("sec-fetch-site")))
        throw forbidden("Cross-origin setup is not allowed", { reason: "origin" });
      if (!onboardingRequired()) throw conflict("This workspace is already set up");
      if (!checkSetupToken(request.headers.get("x-setup-token") ?? undefined)) {
        console.warn(`[onboarding] rejected setup token from ${ip}`);
        throw forbidden("Not allowed");
      }

      const email = body.email.trim().toLowerCase();
      if (body.password.toLowerCase() === email) throw badRequest("Choose a different password");
      const { settings: s } = body;
      const provider = s.captions?.provider;
      const patch = {
        branding: s.branding ?? {},
        captions: provider ? { provider } : {},
        email: s.email?.from ? { from: s.email.from } : {},
        secrets: {
          ...(s.captions?.apiKey && (provider === "soniox" || provider === "gemini")
            ? { [provider === "soniox" ? "sonioxApiKey" : "geminiApiKey"]: s.captions.apiKey }
            : {}),
          ...(s.email?.resendApiKey ? { resendApiKey: s.email.resendApiKey } : {}),
        },
      };
      // before the account exists: bad settings must not leave a half-done setup
      checkSettings(patch);

      const result = await withFirstUser(async () => {
        const res = await auth.api.signUpEmail({
          body: { name: body.name.trim(), email, password: body.password },
          headers: request.headers,
          asResponse: true,
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { message?: string };
          throw badRequest(err.message ?? "Could not create the account");
        }
        const { user } = (await res.json()) as { user: { id: string } };
        await updateSettings(patch, user.id);
        return { res, userId: user.id };
      });
      if (!result) throw conflict("This workspace is already set up");

      console.log(
        `[onboarding] ${email} set up the workspace from ${ip} at ${new Date().toISOString()}`,
      );
      emitToRoom(rooms.all, "settings:changed", {});
      const appName = getSettings().app.name;
      void sendMail({
        to: email,
        subject: `${appName} is ready`,
        html: `<p>You set up <b>${escapeHtml(appName)}</b> and are its admin.</p>`,
        text: `You set up ${appName} and are its admin.`,
      });

      // only better-auth's session cookies go back (with its HttpOnly/Secure/SameSite flags)
      const headers = new Headers({
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      for (const cookie of result.res.headers.getSetCookie()) headers.append("set-cookie", cookie);
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 201, headers });
    },
    {
      body: bodySchema,
      detail: { tags: ["Onboarding"], summary: "Create the first admin and initial settings" },
    },
  );
