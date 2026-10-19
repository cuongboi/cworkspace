import { Elysia, t } from "elysia";
import { encryptSecret, randomSecret, sha256 } from "@/lib/crypto";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { db } from "@/lib/db";
import { isValidHostRule, normalizeCidr } from "@/lib/ip";
import {
  checkChannelPlacement,
  createChannel,
  ensureGroupConversation,
  normalizeChannelName,
} from "@/server/group-chat";
import { sendTestDelivery } from "@/server/integrations/outgoing";
import { emitToRoom, rooms } from "@/websocket/hub";
import { authMacro } from "../plugins/auth";

type Actor = { id: string; role?: string | null };

/** ACTIVE member of the group; `moderate` additionally needs group ADMIN/MODERATOR or instance admin. */
async function requireGroupAccess(groupId: string, user: Actor, moderate: boolean) {
  const member = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
    select: { status: true, role: true },
  });
  const isMember = member?.status === "ACTIVE";
  const instanceAdmin = user.role === "admin";
  if (!isMember && !instanceAdmin) throw notFound("Group not found");
  if (moderate && !instanceAdmin && member?.role === "MEMBER")
    throw forbidden("Only group admins and moderators can manage channels");
}

async function channelOf(channelId: string) {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, groupId: true, isDefault: true, name: true, parentId: true },
  });
  if (!channel) throw notFound("Channel not found");
  return channel;
}

async function integrationOf(integrationId: string) {
  const integration = await db.channelIntegration.findUnique({
    where: { id: integrationId },
    select: { id: true, kind: true, channel: { select: { id: true, groupId: true } } },
  });
  if (!integration) throw notFound("Integration not found");
  return integration;
}

const changed = (groupId: string) =>
  emitToRoom(rooms.group(groupId), "channel:changed", { groupId });

/** Public view of an integration: never the secret, only its last characters. */
const integrationSelect = {
  id: true,
  channelId: true,
  kind: true,
  name: true,
  avatarUrl: true,
  enabled: true,
  secretHint: true,
  allowedIps: true,
  allowedHosts: true,
  targetUrl: true,
  triggerWords: true,
  rateLimitPerMin: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

const settingsBody = {
  name: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
  avatarUrl: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  enabled: t.Optional(t.Boolean()),
  allowedIps: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: 50 })),
  allowedHosts: t.Optional(t.Array(t.String({ maxLength: 253 }), { maxItems: 50 })),
  targetUrl: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  triggerWords: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 40 }), { maxItems: 20 })),
  rateLimitPerMin: t.Optional(t.Integer({ minimum: 1, maximum: 600 })),
};

type Settings = {
  name?: string;
  avatarUrl?: string | null;
  enabled?: boolean;
  allowedIps?: string[];
  allowedHosts?: string[];
  targetUrl?: string | null;
  triggerWords?: string[];
  rateLimitPerMin?: number;
};

/** Validates and normalizes integration settings (CIDRs, host rules, target URL). */
function cleanSettings(input: Settings, kind: string) {
  const out: Settings = { ...input };
  if (input.allowedIps) {
    out.allowedIps = input.allowedIps.map((raw) => {
      const cidr = normalizeCidr(raw);
      if (!cidr) throw badRequest(`"${raw}" is not an IP address or CIDR range`);
      return cidr;
    });
  }
  if (input.allowedHosts) {
    out.allowedHosts = input.allowedHosts.map((raw) => {
      const host = raw.trim().toLowerCase();
      if (!isValidHostRule(host)) throw badRequest(`"${raw}" is not a host name`);
      return host;
    });
  }
  if (input.targetUrl !== undefined && input.targetUrl !== null) {
    let url: URL;
    try {
      url = new URL(input.targetUrl);
    } catch {
      throw badRequest("Target URL is not a valid URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw badRequest("Target URL must use https");
    out.targetUrl = url.toString();
  }
  if (kind === "OUTGOING_WEBHOOK" && input.targetUrl === null)
    throw badRequest("Outgoing webhooks need a target URL");
  if (input.triggerWords)
    out.triggerWords = input.triggerWords.map((w) => w.trim()).filter(Boolean);
  return out;
}

/** A fresh secret: bot tokens carry a recognizable prefix and are looked up by hash. */
function newSecret(kind: string) {
  const secret = randomSecret(kind === "BOT_TOKEN" ? "cwk_bot_" : "whsec_");
  return {
    secret,
    data: {
      secretCipher: encryptSecret(secret),
      secretHint: secret.slice(-4),
      tokenHash: kind === "BOT_TOKEN" ? sha256(secret) : null,
    },
  };
}

export const channelsRoute = new Elysia({ name: "routes.channels" })
  .use(authMacro)
  /** GET /api/groups/:groupId/channels → the channel tree with my read state (creates #general once). */
  .get(
    "/api/groups/:groupId/channels",
    async ({ params: { groupId }, user }) => {
      await requireGroupAccess(groupId, user, false);
      await ensureGroupConversation(groupId);
      const channels = await db.channel.findMany({
        where: { groupId },
        orderBy: [{ isDefault: "desc" }, { position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          groupId: true,
          parentId: true,
          name: true,
          topic: true,
          position: true,
          isDefault: true,
          conversation: {
            select: {
              id: true,
              lastMessageAt: true,
              members: {
                where: { userId: user.id },
                select: { lastReadAt: true, mutedUntil: true },
              },
            },
          },
        },
      });
      return {
        data: channels.map(({ conversation, ...c }) => ({
          ...c,
          conversationId: conversation?.id ?? null,
          lastMessageAt: conversation?.lastMessageAt ?? null,
          lastReadAt: conversation?.members[0]?.lastReadAt ?? null,
          mutedUntil: conversation?.members[0]?.mutedUntil ?? null,
        })),
      };
    },
    {
      auth: true,
      params: t.Object({ groupId: t.String({ minLength: 1 }) }),
      detail: { tags: ["Channels"], summary: "List a group's channels" },
    },
  )
  .post(
    "/api/groups/:groupId/channels",
    async ({ params: { groupId }, body, user }) => {
      await requireGroupAccess(groupId, user, true);
      const channel = await createChannel(
        groupId,
        { name: body.name, parentId: body.parentId ?? null, topic: body.topic?.trim() || null },
        user.id,
      );
      changed(groupId);
      return { data: channel };
    },
    {
      auth: true,
      params: t.Object({ groupId: t.String({ minLength: 1 }) }),
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 60 }),
        parentId: t.Optional(t.Nullable(t.String())),
        topic: t.Optional(t.Nullable(t.String({ maxLength: 250 }))),
      }),
      detail: { tags: ["Channels"], summary: "Create a channel" },
    },
  )
  .patch(
    "/api/channels/:channelId",
    async ({ params: { channelId }, body, user }) => {
      const channel = await channelOf(channelId);
      await requireGroupAccess(channel.groupId, user, true);
      const name = body.name !== undefined ? normalizeChannelName(body.name) : channel.name;
      const parentId = body.parentId !== undefined ? body.parentId : channel.parentId;
      if (channel.isDefault && (name !== channel.name || parentId))
        throw badRequest("#general cannot be renamed or moved");
      if (name !== channel.name || parentId !== channel.parentId)
        await checkChannelPlacement(channel.groupId, name, parentId, channel.id);
      const updated = await db.channel.update({
        where: { id: channelId },
        data: {
          name,
          parentId,
          ...(body.topic !== undefined ? { topic: body.topic?.trim() || null } : {}),
          ...(body.position !== undefined ? { position: body.position } : {}),
        },
      });
      if (!channel.isDefault && name !== channel.name) {
        await db.conversation.updateMany({ where: { channelId }, data: { title: `#${name}` } });
      }
      changed(channel.groupId);
      return { data: updated };
    },
    {
      auth: true,
      params: t.Object({ channelId: t.String({ minLength: 1 }) }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
        parentId: t.Optional(t.Nullable(t.String())),
        topic: t.Optional(t.Nullable(t.String({ maxLength: 250 }))),
        position: t.Optional(t.Integer({ minimum: 0 })),
      }),
      detail: { tags: ["Channels"], summary: "Rename, move or describe a channel" },
    },
  )
  .delete(
    "/api/channels/:channelId",
    async ({ params: { channelId }, user }) => {
      const channel = await channelOf(channelId);
      await requireGroupAccess(channel.groupId, user, true);
      if (channel.isDefault) throw badRequest("#general cannot be deleted");
      // sub-channels, their chats and history go with it (cascades)
      await db.channel.delete({ where: { id: channelId } });
      changed(channel.groupId);
      return { data: { id: channelId } };
    },
    {
      auth: true,
      params: t.Object({ channelId: t.String({ minLength: 1 }) }),
      detail: { tags: ["Channels"], summary: "Delete a channel and its sub-channels" },
    },
  )
  // ── integrations ──────────────────────────────────────────────────
  .post(
    "/api/channels/:channelId/integrations",
    async ({ params: { channelId }, body, user }) => {
      const channel = await channelOf(channelId);
      await requireGroupAccess(channel.groupId, user, true);
      const { kind, ...settings } = body;
      const clean = cleanSettings(
        {
          ...settings,
          targetUrl: settings.targetUrl ?? (kind === "OUTGOING_WEBHOOK" ? null : undefined),
        },
        kind,
      );
      const { secret, data } = newSecret(kind);
      const integration = await db.channelIntegration.create({
        data: {
          ...clean,
          name: clean.name ?? "Integration",
          kind,
          channelId,
          createdById: user.id,
          ...data,
        },
        select: integrationSelect,
      });
      return { data: { integration, secret } };
    },
    {
      auth: true,
      params: t.Object({ channelId: t.String({ minLength: 1 }) }),
      body: t.Object({
        kind: t.Union([
          t.Literal("INCOMING_WEBHOOK"),
          t.Literal("OUTGOING_WEBHOOK"),
          t.Literal("BOT_TOKEN"),
        ]),
        ...settingsBody,
        name: t.String({ minLength: 1, maxLength: 60 }),
      }),
      detail: { tags: ["Channels"], summary: "Add an integration (returns its secret once)" },
    },
  )
  .patch(
    "/api/integrations/:integrationId",
    async ({ params: { integrationId }, body, user }) => {
      const integration = await integrationOf(integrationId);
      await requireGroupAccess(integration.channel.groupId, user, true);
      const updated = await db.channelIntegration.update({
        where: { id: integrationId },
        data: cleanSettings(body, integration.kind),
        select: integrationSelect,
      });
      return { data: updated };
    },
    {
      auth: true,
      params: t.Object({ integrationId: t.String({ minLength: 1 }) }),
      body: t.Object(settingsBody),
      detail: { tags: ["Channels"], summary: "Update an integration's settings" },
    },
  )
  .delete(
    "/api/integrations/:integrationId",
    async ({ params: { integrationId }, user }) => {
      const integration = await integrationOf(integrationId);
      await requireGroupAccess(integration.channel.groupId, user, true);
      await db.channelIntegration.delete({ where: { id: integrationId } });
      return { data: { id: integrationId } };
    },
    {
      auth: true,
      params: t.Object({ integrationId: t.String({ minLength: 1 }) }),
      detail: { tags: ["Channels"], summary: "Remove an integration" },
    },
  )
  .post(
    "/api/integrations/:integrationId/rotate",
    async ({ params: { integrationId }, user }) => {
      const integration = await integrationOf(integrationId);
      await requireGroupAccess(integration.channel.groupId, user, true);
      const { secret, data } = newSecret(integration.kind);
      const updated = await db.channelIntegration.update({
        where: { id: integrationId },
        data,
        select: integrationSelect,
      });
      return { data: { integration: updated, secret } };
    },
    {
      auth: true,
      params: t.Object({ integrationId: t.String({ minLength: 1 }) }),
      detail: { tags: ["Channels"], summary: "Generate a new secret (the old one stops working)" },
    },
  )
  .post(
    "/api/integrations/:integrationId/test",
    async ({ params: { integrationId }, user }) => {
      const integration = await integrationOf(integrationId);
      await requireGroupAccess(integration.channel.groupId, user, true);
      if (integration.kind !== "OUTGOING_WEBHOOK")
        throw badRequest("Only outgoing webhooks can send a test delivery");
      return { data: await sendTestDelivery(integrationId) };
    },
    {
      auth: true,
      params: t.Object({ integrationId: t.String({ minLength: 1 }) }),
      detail: { tags: ["Channels"], summary: "Send a signed test event to an outgoing webhook" },
    },
  );
