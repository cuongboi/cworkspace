import { SOCIAL_PROVIDERS } from "@app/shared/app-config";
import { publicAppConfig } from "@/server/spa";
import { Elysia, t } from "elysia";
import { env } from "@/env";
import { db } from "@/lib/db";
import { escapeHtml, sendMailOrThrow } from "@/lib/mail";
import { badRequest, forbidden, notFound, upstreamError } from "@/lib/errors";
import { testCaptionKey } from "@/server/captions";
import { rateLimit } from "@/server/rate-limit";
import {
  CAPTION_PROVIDERS,
  getSettings,
  SECRET_NAMES,
  type SecretName,
  secretHints,
  type Settings,
  updateSettings,
} from "@/server/settings";
import { presignDownload } from "@/server/storage";
import { emitToRoom, rooms } from "@/websocket/hub";
import { authMacro } from "../plugins/auth";

const BRANDING_IMAGES = ["icon", "ogImage"] as const;
type BrandingImage = (typeof BRANDING_IMAGES)[number];

const str = (max: number) => t.Optional(t.String({ maxLength: max }));

const brandingSchema = t.Object({
  name: str(60),
  shortName: str(30),
  description: str(300),
  locale: str(10),
  twitterSite: str(16),
  ogImage: str(2048),
  icon: str(2048),
  // an uploaded image (POST /api/uploads, isPublic) served at /api/branding/<kind>
  iconFile: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
  ogImageFile: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
});

const captionsSchema = t.Object({
  provider: t.Optional(t.UnionEnum(CAPTION_PROVIDERS)),
  sonioxModel: str(80),
  geminiTranscribeModel: str(80),
  geminiTranslateModel: str(80),
});

const socialEntry = t.Object({ enabled: t.Boolean(), clientId: t.String({ maxLength: 512 }) });
const emailSchema = t.Object({ from: str(200) });

const pushSchema = t.Object({
  projectId: str(200),
  clientEmail: str(320),
  apiKey: str(200),
  appId: str(200),
  messagingSenderId: str(64),
  vapidKey: str(200),
});

const socialSchema = t.Partial(
  t.Object(Object.fromEntries(SOCIAL_PROVIDERS.map((p) => [p, socialEntry])) as never),
);

const secretsSchema = t.Partial(
  t.Object(
    Object.fromEntries(
      SECRET_NAMES.map((n) => [n, t.Nullable(t.String({ maxLength: 4096 }))]),
    ) as never,
  ),
);

/** What an admin sees: every setting, `.env` defaults, and only hints of the secrets. */
function adminView(s: Settings) {
  return {
    branding: s.branding,
    captions: s.captions,
    social: s.social,
    email: s.email,
    push: s.push,
    effective: { app: s.app, caption: s.caption, mail: s.mail, firebase: s.firebase },
    secrets: secretHints(),
    callbackUrl: `${env.BETTER_AUTH_URL}${env.BETTER_AUTH_BASE_PATH}/callback/`,
  };
}

/** Replaces an uploaded branding image's file id with its public URL (and checks the file). */
async function resolveImage(branding: Record<string, unknown>, kind: BrandingImage): Promise<void> {
  const fileKey = `${kind}File`;
  const id = branding[fileKey];
  if (id === undefined) {
    // keep the image uploaded before, unless the URL field was edited away from it
    const before = getSettings().branding as Record<string, unknown>;
    if (before[fileKey] && branding[kind] === before[kind]) branding[fileKey] = before[fileKey];
    return;
  }
  if (id === null) {
    delete branding[fileKey];
    if (String(branding[kind] ?? "").startsWith("/api/branding/")) delete branding[kind];
    return;
  }
  const file = await db.attachment.findUnique({
    where: { id: String(id) },
    select: { mimeType: true },
  });
  if (!file?.mimeType.startsWith("image/")) throw badRequest(`${kind} must be an uploaded image`);
  // the version busts browser and crawler caches when the image changes
  branding[kind] = `/api/branding/${kind}?v=${String(id).slice(-8)}`;
}

/**
 * Instance settings (Settings → General / Theme / Integrations / Sign-in).
 *   GET   /api/settings/public    branding for every visitor (the SPA shell also embeds it)
 *   GET   /api/admin/settings     admins: everything except secrets (hints only)
 *   PATCH /api/admin/settings     admins: per-section replace; secrets set / clear / keep
 *   POST  /api/admin/settings/test/:provider   admins: try a caption provider key
 *   POST  /api/admin/settings/test-email       admins: send a test email to themselves
 *   GET   /api/branding/:kind     uploaded icon / share image (public: crawlers and the PWA)
 */
export const settingsRoute = new Elysia({ name: "routes.settings" })
  .use(authMacro)
  .get(
    "/api/settings/public",
    ({ set }) => {
      set.headers["cache-control"] = "no-cache";
      return { data: publicAppConfig() };
    },
    { detail: { tags: ["Settings"], summary: "Public branding of this instance" } },
  )
  .get(
    "/api/branding/:kind",
    async ({ params, set, redirect }) => {
      const id = (getSettings().branding as Record<string, unknown>)[`${params.kind}File`];
      if (typeof id !== "string") throw notFound();
      const file = await db.attachment.findUnique({
        where: { id },
        select: { key: true, name: true },
      });
      if (!file) throw notFound();
      set.headers["cache-control"] = "public, max-age=240";
      return redirect(await presignDownload(file.key, file.name, true), 302);
    },
    {
      params: t.Object({ kind: t.UnionEnum(BRANDING_IMAGES) }),
      detail: { tags: ["Settings"], summary: "Uploaded app icon or share image" },
    },
  )
  .get(
    "/api/admin/settings",
    ({ user, set }) => {
      if (user.role !== "admin") throw forbidden("Only admins can view settings");
      set.headers["cache-control"] = "private, no-store";
      return { data: adminView(getSettings()) };
    },
    { auth: true, detail: { tags: ["Settings"], summary: "Instance settings (admin)" } },
  )
  .patch(
    "/api/admin/settings",
    async ({ user, body, set }) => {
      if (user.role !== "admin") throw forbidden("Only admins can change settings");
      const branding = body.branding ? { ...body.branding } : undefined;
      if (branding) for (const kind of BRANDING_IMAGES) await resolveImage(branding, kind);
      const next = await updateSettings(
        {
          branding,
          captions: body.captions,
          social: body.social,
          email: body.email,
          push: body.push,
          secrets: body.secrets as Partial<Record<SecretName, string | null>> | undefined,
        },
        user.id,
      );
      // open tabs refetch settings, the login page its sign-in buttons
      emitToRoom(rooms.all, "settings:changed", {});
      set.headers["cache-control"] = "private, no-store";
      return { data: adminView(next) };
    },
    {
      auth: true,
      body: t.Object({
        branding: t.Optional(brandingSchema),
        captions: t.Optional(captionsSchema),
        social: t.Optional(socialSchema),
        email: t.Optional(emailSchema),
        push: t.Optional(pushSchema),
        secrets: t.Optional(secretsSchema),
      }),
      detail: { tags: ["Settings"], summary: "Update instance settings (admin)" },
    },
  )
  .post(
    "/api/admin/settings/test/:provider",
    async ({ user, params, body }) => {
      if (user.role !== "admin") throw forbidden("Only admins can test keys");
      if (!rateLimit(`settings-test:${user.id}`, 10, 60_000)) throw badRequest("Try again later");
      const error = await testCaptionKey(params.provider, body.apiKey || undefined);
      if (error) throw upstreamError(error);
      return { data: { ok: true } };
    },
    {
      auth: true,
      params: t.Object({ provider: t.UnionEnum(["soniox", "gemini"] as const) }),
      // a key typed in the form but not saved yet; else the stored one
      body: t.Object({ apiKey: t.Optional(t.String({ maxLength: 4096 })) }),
      detail: { tags: ["Settings"], summary: "Check a caption provider API key (admin)" },
    },
  )
  .post(
    "/api/admin/settings/test-email",
    async ({ user }) => {
      if (user.role !== "admin") throw forbidden("Only admins can send test emails");
      if (!rateLimit(`settings-test-email:${user.id}`, 5, 60_000))
        throw badRequest("Try again later");
      const name = escapeHtml(getSettings().app.name);
      try {
        await sendMailOrThrow({
          to: user.email,
          subject: `${getSettings().app.name}: test email`,
          html: `<p>Email from ${name} works.</p>`,
          text: `Email from ${getSettings().app.name} works.`,
        });
      } catch (err) {
        throw upstreamError((err as Error).message);
      }
      return { data: { ok: true, to: user.email } };
    },
    { auth: true, detail: { tags: ["Settings"], summary: "Send a test email (admin)" } },
  );
