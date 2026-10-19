import { Elysia, t } from "elysia";
import { env } from "@/env";
import { decryptSecret, safeEqual, sha256, verifySignature } from "@/lib/crypto";
import { db } from "@/lib/db";
import { badRequest, forbidden, notFound, tooManyRequests, unauthorized } from "@/lib/errors";
import { ipAllowed } from "@/lib/ip";
import { rateLimit } from "@/server/rate-limit";
import { MAX_BOT_TEXT, postBotMessage, recordDelivery } from "@/server/integrations/outgoing";

/**
 * Public endpoints for channel integrations (no session): incoming webhooks signed with the
 * integration's secret, and a bot API authenticated by a channel-scoped bearer token. Every
 * failure answers the same way for unknown and disabled integrations (no existence leak).
 */

type Ctx = {
  request: Request;
  server: { requestIP(r: Request): { address: string } | null } | null;
};

function clientIp({ request, server }: Ctx) {
  if (env.TRUST_PROXY) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return server?.requestIP(request)?.address ?? null;
}

const integrationFields = {
  id: true,
  kind: true,
  enabled: true,
  secretCipher: true,
  allowedIps: true,
  rateLimitPerMin: true,
  createdById: true,
  channelId: true,
} as const;

function gate(
  integration: { id: string; enabled: boolean; allowedIps: string[]; rateLimitPerMin: number },
  ip: string | null,
) {
  if (!integration.enabled) throw notFound("Integration not found");
  if (!ipAllowed(ip, integration.allowedIps)) throw forbidden("This address is not allowed");
  if (!rateLimit(`integration:${integration.id}`, integration.rateLimitPerMin, 60_000))
    throw tooManyRequests();
}

async function botFromHeader(authorization: string | null) {
  const token = authorization?.match(/^Bearer\s+(cwk_bot_\S+)$/)?.[1];
  if (!token) throw unauthorized("Missing bot token");
  const integration = await db.channelIntegration.findUnique({
    where: { tokenHash: sha256(token) },
    select: integrationFields,
  });
  // hash lookup found it; compare the sealed token too, so a hash collision can't authenticate
  if (
    !integration ||
    integration.kind !== "BOT_TOKEN" ||
    !safeEqual(decryptSecret(integration.secretCipher), token)
  )
    throw unauthorized("Invalid bot token");
  return integration;
}

const messageBody = t.Object({
  text: t.String({ minLength: 1, maxLength: MAX_BOT_TEXT }),
  replyToId: t.Optional(t.Nullable(t.String())),
});

export const hooksRoute = new Elysia({ name: "routes.hooks" })
  /**
   * POST /api/hooks/:integrationId { text } — incoming webhook. Headers:
   * `X-Cworkplace-Timestamp: <unix seconds>` and
   * `X-Cworkplace-Signature: v1=hex(hmac_sha256(secret, timestamp + "." + rawBody))`.
   */
  .post(
    "/api/hooks/:integrationId",
    async (ctx) => {
      const { params, request } = ctx;
      const started = Date.now();
      const raw = await request.text();
      const integration = await db.channelIntegration.findUnique({
        where: { id: params.integrationId },
        select: integrationFields,
      });
      if (!integration || integration.kind !== "INCOMING_WEBHOOK")
        throw notFound("Integration not found");
      gate(integration, clientIp(ctx));
      const ok = verifySignature(
        decryptSecret(integration.secretCipher),
        request.headers.get("x-cworkplace-timestamp"),
        raw,
        request.headers.get("x-cworkplace-signature"),
      );
      if (!ok) {
        await recordDelivery(integration.id, {
          direction: "in",
          status: 401,
          ok: false,
          durationMs: Date.now() - started,
          error: "Bad or expired signature",
        });
        throw unauthorized("Bad or expired signature");
      }
      let body: { text?: unknown; replyToId?: unknown };
      try {
        body = JSON.parse(raw);
      } catch {
        throw badRequest("Body must be JSON");
      }
      if (typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_BOT_TEXT)
        throw badRequest(`"text" must be 1–${MAX_BOT_TEXT} characters`);
      const message = await postBotMessage(
        integration,
        body.text,
        typeof body.replyToId === "string" ? body.replyToId : null,
      );
      if (!message) throw notFound("Channel not found");
      await recordDelivery(integration.id, {
        direction: "in",
        status: 200,
        ok: true,
        durationMs: Date.now() - started,
      });
      return { data: { id: message.id } };
    },
    {
      // the raw body is needed for the signature: don't let Elysia parse it
      parse: "none",
      params: t.Object({ integrationId: t.String({ minLength: 1 }) }),
      detail: { tags: ["Integrations"], summary: "Incoming webhook: post a message to a channel" },
    },
  )
  /** GET /api/bot/messages?limit&before — recent messages of the token's channel. */
  .get(
    "/api/bot/messages",
    async (ctx) => {
      const integration = await botFromHeader(ctx.request.headers.get("authorization"));
      gate(integration, clientIp(ctx));
      const limit = Math.min(Number(ctx.query.limit ?? 50) || 50, 100);
      const messages = await db.message.findMany({
        where: {
          conversation: { channelId: integration.channelId },
          deletedAt: null,
          ...(ctx.query.before ? { createdAt: { lt: new Date(ctx.query.before) } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          content: true,
          type: true,
          replyToId: true,
          createdAt: true,
          sender: { select: { id: true, name: true } },
          integrationId: true,
        },
      });
      return { data: messages };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
        before: t.Optional(t.String({ format: "date-time" })),
      }),
      detail: { tags: ["Integrations"], summary: "Bot API: read the channel's messages" },
    },
  )
  /** POST /api/bot/messages { text, replyToId? } — post as the bot. */
  .post(
    "/api/bot/messages",
    async (ctx) => {
      const integration = await botFromHeader(ctx.request.headers.get("authorization"));
      gate(integration, clientIp(ctx));
      const message = await postBotMessage(integration, ctx.body.text, ctx.body.replyToId);
      if (!message) throw notFound("Channel not found");
      return { data: message };
    },
    {
      body: messageBody,
      detail: { tags: ["Integrations"], summary: "Bot API: post a message to the channel" },
    },
  );
