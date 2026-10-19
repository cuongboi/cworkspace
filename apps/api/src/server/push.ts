import { env } from "../env";

/**
 * Background push through Firebase Cloud Messaging. Messages are data-only so the service
 * worker (`web/public/firebase-messaging-sw.js`) decides whether to show them: it stays quiet
 * while an app window is focused, since the socket already updated the UI.
 */

export type PushPayload = {
  title: string;
  body: string;
  /** In-app path opened on click. */
  url: string;
  /** Same tag replaces the previous notification (one per conversation, call, …). */
  tag?: string;
  kind?: "notification" | "message" | "call" | "dismiss";
  /** `kind: "call"`: lets the notification's Accept / Decline buttons act on the call. */
  callId?: string;
};

export const pushEnabled = Boolean(
  env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY,
);

// lazy: db.ts installs the realtime plugin, which imports this file
const getDb = async () => (await import("../lib/db")).db;

let messagingPromise: Promise<import("firebase-admin/messaging").Messaging> | undefined;
function messaging() {
  messagingPromise ??= (async () => {
    const { cert, getApps, initializeApp } = await import("firebase-admin/app");
    const { getMessaging } = await import("firebase-admin/messaging");
    const app =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: env.FIREBASE_PRIVATE_KEY,
        }),
      });
    return getMessaging(app);
  })();
  return messagingPromise;
}

const DEAD_TOKEN = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/** Sends to every registered device of `userIds`. Never throws. */
export async function sendPush(userIds: string[], payload: PushPayload) {
  if (!pushEnabled || userIds.length === 0) return;
  try {
    const db = await getDb();
    const rows = await db.pushToken.findMany({
      where: { userId: { in: [...new Set(userIds)] } },
      select: { token: true },
    });
    if (rows.length === 0) return;
    const tokens = rows.map((r) => r.token);
    const isCall = payload.kind === "call";
    const data = {
      title: payload.title,
      body: payload.body.slice(0, 240),
      url: payload.url,
      tag: payload.tag ?? "",
      kind: payload.kind ?? "notification",
      callId: payload.callId ?? "",
    };
    const fcm = await messaging();
    const dead: string[] = [];
    // FCM accepts at most 500 tokens per multicast
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const res = await fcm.sendEachForMulticast({
        tokens: batch,
        data,
        webpush: {
          headers: { Urgency: "high", TTL: String(isCall ? 30 : 24 * 60 * 60) },
          fcmOptions: { link: payload.url },
        },
      });
      res.responses.forEach((r, j) => {
        if (!r.success && r.error && DEAD_TOKEN.has(r.error.code)) dead.push(batch[j]!);
      });
    }
    if (dead.length) await db.pushToken.deleteMany({ where: { token: { in: dead } } });
  } catch (err) {
    console.error("[push]", err);
  }
}
