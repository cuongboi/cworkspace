import {
  type AppConfig,
  parseAppConfig,
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from "@app/shared/app-config";
// relative imports: reached from lib/db.ts (realtime plugin → push), which the web app type-imports
import { env } from "../env";
import { badRequest } from "../lib/errors";
import { db } from "../lib/db";

/**
 * Instance settings an admin edits at runtime (Settings → General / Theme / Integrations /
 * Sign-in), stored in the single `AppSetting` row. `.env` provides the defaults, so a fresh
 * install behaves as before; a stored value wins field by field.
 *
 * Kept in memory (one API process): `getSettings()` is synchronous and cheap, and
 * `onSettingsChange` lets the SPA shell, better-auth and the caption provider rebuild.
 */

export const CAPTION_PROVIDERS = ["soniox", "gemini", "off"] as const;
export type CaptionProviderId = (typeof CAPTION_PROVIDERS)[number];

export const SECRET_NAMES = [
  "sonioxApiKey",
  "geminiApiKey",
  "googleClientSecret",
  "githubClientSecret",
  "lineClientSecret",
  "resendApiKey",
  "firebasePrivateKey",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

/** Admin overrides of `AppConfig` (strings left empty fall back to `.env`). */
export type BrandingSettings = {
  name?: string;
  shortName?: string;
  description?: string;
  locale?: string;
  twitterSite?: string;
  ogImage?: string;
  icon?: string;
};

export type CaptionSettings = {
  provider?: CaptionProviderId;
  sonioxModel?: string;
  geminiTranscribeModel?: string;
  geminiTranslateModel?: string;
};

export type SocialSettings = Partial<
  Record<SocialProvider, { enabled: boolean; clientId: string }>
>;

export type EmailSettings = { from?: string };

export type PushSettings = {
  projectId?: string;
  clientEmail?: string;
  apiKey?: string;
  appId?: string;
  messagingSenderId?: string;
  vapidKey?: string;
};

export type StoredSettings = {
  branding: BrandingSettings;
  captions: CaptionSettings;
  social: SocialSettings;
  email: EmailSettings;
  push: PushSettings;
};

export type Settings = StoredSettings & {
  /** Effective email sender (stored value, else `.env`). */
  mail: { from: string };
  /** Effective Firebase config (stored values, else `.env`); `enabled` once the server can send. */
  firebase: Required<PushSettings> & { enabled: boolean };
  /** Branding merged over `.env`, as rendered into the SPA shell. */
  app: AppConfig;
  /** Effective caption config (stored value, else `.env`). */
  caption: {
    provider: CaptionProviderId;
    sonioxModel: string;
    geminiTranscribeModel: string;
    geminiTranslateModel: string;
  };
};

type Secrets = Partial<Record<SecretName, string>>;

// --- secrets at rest ---------------------------------------------------------------------------

let keyPromise: Promise<CryptoKey> | undefined;

/** AES-256-GCM key derived from the instance secret: the DB alone doesn't reveal the API keys. */
function secretKey() {
  keyPromise ??= (async () => {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.SETTINGS_SECRET || env.BETTER_AUTH_SECRET),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode("cworkplace/app-setting/secrets"),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  return keyPromise;
}

async function encryptSecrets(secrets: Secrets): Promise<string> {
  if (!Object.keys(secrets).length) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await secretKey(),
    new TextEncoder().encode(JSON.stringify(secrets)),
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(data).toString("base64")}`;
}

async function decryptSecrets(blob: string): Promise<Secrets> {
  if (!blob) return {};
  const [iv, data] = blob.split(".");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(iv!, "base64") },
      await secretKey(),
      Buffer.from(data!, "base64"),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as Secrets;
  } catch {
    // the instance secret changed: the stored keys are unreadable, the admin re-enters them
    console.error("[settings] stored secrets can't be decrypted (instance secret changed?)");
    return {};
  }
}

// --- cache -------------------------------------------------------------------------------------

const ROW_ID = "default";

const envSecrets = (): Secrets => ({
  sonioxApiKey: env.SONIOX_API_KEY || undefined,
  geminiApiKey: env.GEMINI_API_KEY || undefined,
  resendApiKey: env.RESEND_API_KEY || undefined,
  firebasePrivateKey: env.FIREBASE_PRIVATE_KEY || undefined,
});

function resolve(stored: StoredSettings, secrets: Secrets): Settings {
  const app = parseAppConfig(env, {
    name: stored.branding.name,
    info: stripEmpty(stored.branding),
  });
  app.socialProviders = SOCIAL_PROVIDERS.filter((p) => socialReady(stored.social, secrets, p));
  const c = stored.captions;
  const sonioxKey = secrets.sonioxApiKey || env.SONIOX_API_KEY;
  const geminiKey = secrets.geminiApiKey || env.GEMINI_API_KEY;
  const p = stored.push;
  const firebase = {
    projectId: p.projectId || env.FIREBASE_PROJECT_ID,
    clientEmail: p.clientEmail || env.FIREBASE_CLIENT_EMAIL,
    apiKey: p.apiKey || env.FIREBASE_API_KEY,
    appId: p.appId || env.FIREBASE_APP_ID,
    messagingSenderId: p.messagingSenderId || env.FIREBASE_MESSAGING_SENDER_ID,
    vapidKey: p.vapidKey || env.FIREBASE_VAPID_KEY,
  };
  const firebaseKey = secrets.firebasePrivateKey || env.FIREBASE_PRIVATE_KEY;
  return {
    ...stored,
    app,
    mail: { from: stored.email.from || env.MAIL_FROM },
    firebase: {
      ...firebase,
      enabled: Boolean(firebase.projectId && firebase.clientEmail && firebaseKey),
    },
    caption: {
      provider: c.provider ?? (sonioxKey ? "soniox" : geminiKey ? "gemini" : "off"),
      sonioxModel: c.sonioxModel || env.SONIOX_MODEL,
      geminiTranscribeModel: c.geminiTranscribeModel || env.GEMINI_TRANSCRIBE_MODEL,
      geminiTranslateModel: c.geminiTranslateModel || env.GEMINI_TRANSLATE_MODEL,
    },
  };
}

function socialReady(social: SocialSettings, secrets: Secrets, p: SocialProvider) {
  const s = social[p];
  return Boolean(s?.enabled && s.clientId && secrets[`${p}ClientSecret`]);
}

const stripEmpty = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null));

const EMPTY: StoredSettings = {
  branding: {},
  captions: {},
  social: {},
  email: {},
  push: {},
};

let stored: StoredSettings = EMPTY;
let secrets: Secrets = {};
let current: Settings = resolve(EMPTY, {});
const listeners = new Set<(s: Settings) => void>();

/** Reads the row once at boot (and after every update). */
export async function loadSettings() {
  const row = await db.appSetting.findUnique({ where: { id: ROW_ID } });
  stored = row
    ? {
        branding: (row.branding ?? {}) as BrandingSettings,
        captions: (row.captions ?? {}) as CaptionSettings,
        social: (row.social ?? {}) as SocialSettings,
        email: (row.email ?? {}) as EmailSettings,
        push: (row.push ?? {}) as PushSettings,
      }
    : EMPTY;
  secrets = row ? await decryptSecrets(row.secrets) : {};
  try {
    current = resolve(stored, secrets);
  } catch (err) {
    // a row saved before a validation rule tightened: keep serving with `.env` branding
    console.error("[settings] invalid stored branding, using .env:", (err as Error).message);
    current = resolve({ ...stored, branding: {} }, secrets);
  }
  for (const fn of listeners) {
    try {
      fn(current);
    } catch (err) {
      console.error("[settings] listener", err);
    }
  }
  return current;
}

export const getSettings = () => current;

/** A stored secret, else the `.env` value for provider keys. */
export const getSecret = (name: SecretName): string => secrets[name] || envSecrets()[name] || "";

/** Called now and after every change. */
export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

/** Last 4 characters of each secret that is set (stored or `.env`); never the secret itself. */
export function secretHints(): Record<SecretName, string | null> {
  return Object.fromEntries(
    SECRET_NAMES.map((n) => {
      const v = getSecret(n);
      return [n, v ? `…${v.slice(-4)}` : null];
    }),
  ) as Record<SecretName, string | null>;
}

export type SettingsPatch = Partial<StoredSettings> & {
  /** a string sets the secret, null clears it, omitted keeps it */
  secrets?: Partial<Record<SecretName, string | null>>;
};

function merge(patch: SettingsPatch) {
  const next: StoredSettings = {
    branding: patch.branding ?? stored.branding,
    captions: patch.captions ?? stored.captions,
    social: patch.social ?? stored.social,
    email: patch.email ?? stored.email,
    push: patch.push ?? stored.push,
  };
  const nextSecrets: Secrets = { ...secrets };
  for (const [name, value] of Object.entries(patch.secrets ?? {})) {
    if (value === null || value === "") delete nextSecrets[name as SecretName];
    // a PEM pasted from a JSON key file keeps its escaped newlines
    else if (typeof value === "string")
      nextSecrets[name as SecretName] = value.trim().replace(/\\n/g, "\n");
  }
  try {
    resolve(next, nextSecrets);
  } catch (err) {
    // parseAppConfig's messages name APP_INFO fields; they read fine for the form too
    throw badRequest((err as Error).message.replace(/^APP_INFO\./, ""));
  }
  return { next, nextSecrets };
}

/** Throws `badRequest` when `patch` would not apply (before doing anything irreversible). */
export function checkSettings(patch: SettingsPatch) {
  merge(patch);
}

export async function updateSettings(patch: SettingsPatch, userId: string) {
  const { next, nextSecrets } = merge(patch);
  const data = { ...next, secrets: await encryptSecrets(nextSecrets), updatedById: userId };
  await db.appSetting.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, ...data },
    update: data,
  });
  return loadSettings();
}
