import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { toPlainText } from "@app/shared/mentions";
import { env } from "../../env";
import { decryptSecret, signPayload } from "../../lib/crypto";
import { hostAllowed, isPrivateIp } from "../../lib/ip";

/**
 * Channel integrations, server side: posting BOT messages, and outgoing webhooks (a signed POST
 * per matching channel message, optionally answered with a message posted back).
 * Lazy `db` import: db.ts installs the realtime plugin, which imports this module.
 */
const getDb = async () => (await import("../../lib/db")).db;

const TIMEOUT_MS = 5_000;
const RETRIES = 2;
const KEEP_DELIVERIES = 50;
export const MAX_BOT_TEXT = 4_000;

/** Posts a BOT message as the integration (its creator is the stored sender). */
export async function postBotMessage(
  integration: { id: string; createdById: string; channelId: string },
  text: string,
  replyToId?: string | null,
) {
  const db = await getDb();
  const conversation = await db.conversation.findUnique({
    where: { channelId: integration.channelId },
    select: { id: true },
  });
  if (!conversation) return null;
  if (replyToId) {
    const parent = await db.message.findUnique({
      where: { id: replyToId },
      select: { conversationId: true },
    });
    if (parent?.conversationId !== conversation.id) replyToId = null;
  }
  // bots can't forge mentions (`@[Name](id)` tokens): their text is posted as plain text
  const content = toPlainText(text).slice(0, MAX_BOT_TEXT);
  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      senderId: integration.createdById,
      integrationId: integration.id,
      type: "BOT",
      content,
      replyToId: replyToId ?? null,
    },
    select: { id: true, conversationId: true, createdAt: true, content: true },
  });
  await db.channelIntegration.update({
    where: { id: integration.id },
    data: { lastUsedAt: new Date() },
    select: { id: true },
  });
  return message;
}

export async function recordDelivery(
  integrationId: string,
  entry: {
    direction: "in" | "out";
    status: number;
    ok: boolean;
    durationMs: number;
    error?: string;
  },
) {
  const db = await getDb();
  await db.integrationDelivery.create({
    data: { integrationId, ...entry, error: entry.error?.slice(0, 500) ?? null },
  });
  const stale = await db.integrationDelivery.findMany({
    where: { integrationId },
    orderBy: { createdAt: "desc" },
    skip: KEEP_DELIVERIES,
    select: { id: true },
  });
  if (stale.length)
    await db.integrationDelivery.deleteMany({ where: { id: { in: stale.map((d) => d.id) } } });
}

/** Rejects non-http(s), disallowed hosts and (unless allowed by env) private addresses. */
async function checkTarget(rawUrl: string, allowedHosts: string[]) {
  const url = new URL(rawUrl);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && env.ALLOW_PRIVATE_WEBHOOKS && local)
  )
    throw new Error("Target must use https");
  if (!hostAllowed(url.hostname, allowedHosts)) throw new Error("Host is not in the allowlist");
  if (env.ALLOW_PRIVATE_WEBHOOKS) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || addresses.some(isPrivateIp))
    throw new Error("Target resolves to a private address");
  return url;
}

type OutgoingIntegration = {
  id: string;
  createdById: string;
  channelId: string;
  secretCipher: string;
  targetUrl: string | null;
  allowedHosts: string[];
};

/** Signed POST with timeout and retries; posts `{ text }` replies back. Never throws. */
async function deliver(
  integration: OutgoingIntegration,
  payload: Record<string, unknown>,
  replyToId: string | null,
) {
  const started = Date.now();
  let status = 0;
  let error: string | undefined;
  try {
    if (!integration.targetUrl) throw new Error("No target URL");
    const url = await checkTarget(integration.targetUrl, integration.allowedHosts);
    const body = JSON.stringify(payload);
    const secret = decryptSecret(integration.secretCipher);
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt) await Bun.sleep(500 * 2 ** attempt);
      const ts = String(Math.floor(Date.now() / 1000));
      try {
        const res = await fetch(url, {
          method: "POST",
          redirect: "manual", // a redirect could point at a private address
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            "content-type": "application/json",
            "user-agent": "cworkplace-webhooks/1",
            "x-cworkplace-timestamp": ts,
            "x-cworkplace-signature": signPayload(secret, ts, body),
          },
          body,
        });
        status = res.status;
        if (res.ok) {
          error = undefined;
          const reply = await res
            .json()
            .then((j: unknown) => (j && typeof j === "object" && "text" in j ? j.text : null))
            .catch(() => null);
          if (typeof reply === "string" && reply.trim())
            await postBotMessage(integration, reply, replyToId);
          break;
        }
        error = `HTTP ${res.status}`;
        if (res.status < 500 && res.status !== 429) break; // client errors won't fix themselves
      } catch (err) {
        error = err instanceof Error ? err.message : "Request failed";
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Request failed";
  }
  const result = { ok: !error, status, durationMs: Date.now() - started, error };
  await recordDelivery(integration.id, { direction: "out", ...result }).catch(() => undefined);
  return result;
}

const matches = (text: string, triggers: string[]) => {
  if (triggers.length === 0) return true;
  const t = text.trimStart().toLowerCase();
  return triggers.some((w) => t === w.toLowerCase() || t.startsWith(`${w.toLowerCase()} `));
};

/** Called for each new TEXT message; fans out to the channel's enabled outgoing webhooks. */
export async function dispatchOutgoing(message: {
  id: string;
  conversationId: string;
  content: string;
  createdAt: Date;
  sender: { id: string; name: string };
}) {
  const db = await getDb();
  const conversation = await db.conversation.findUnique({
    where: { id: message.conversationId },
    select: {
      channel: {
        select: {
          id: true,
          name: true,
          group: { select: { id: true, name: true, slug: true } },
          integrations: {
            where: { kind: "OUTGOING_WEBHOOK", enabled: true },
            select: {
              id: true,
              createdById: true,
              channelId: true,
              secretCipher: true,
              targetUrl: true,
              allowedHosts: true,
              triggerWords: true,
            },
          },
        },
      },
    },
  });
  const channel = conversation?.channel;
  if (!channel?.integrations.length) return;
  const text = toPlainText(message.content);
  for (const integration of channel.integrations) {
    if (!matches(text, integration.triggerWords)) continue;
    void deliver(
      integration,
      {
        event: "message.created",
        channel: { id: channel.id, name: channel.name },
        group: channel.group,
        message: { id: message.id, text, createdAt: message.createdAt, user: message.sender },
        ts: Date.now(),
      },
      message.id,
    );
  }
}

/** "Send test" from the settings dialog: one delivery, result returned to the caller. */
export async function sendTestDelivery(integrationId: string) {
  const db = await getDb();
  const integration = await db.channelIntegration.findUnique({
    where: { id: integrationId },
    select: {
      id: true,
      createdById: true,
      channelId: true,
      secretCipher: true,
      targetUrl: true,
      allowedHosts: true,
      channel: { select: { id: true, name: true } },
    },
  });
  if (!integration) return { ok: false, status: 0, durationMs: 0, error: "Not found" };
  return deliver(
    integration,
    { event: "ping", channel: integration.channel, ts: Date.now() },
    null,
  );
}
