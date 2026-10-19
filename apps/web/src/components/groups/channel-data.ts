import { api, db } from "@/lib/api-client"

/**
 * Group channels (chat rooms inside a group) and their integrations. Keys start with the model
 * name so `useRealtimeSync` refreshes them on `channel:changed` / `message:new`.
 */

export type ChannelItem = {
  id: string
  groupId: string
  parentId: string | null
  name: string
  topic: string | null
  position: number
  isDefault: boolean
  conversationId: string | null
  lastMessageAt: Date | null
  lastReadAt: Date | null
  mutedUntil: Date | null
}

export type ChannelNode = ChannelItem & { children: ChannelItem[] }

export const channelsKey = (groupId: string) =>
  ["channel", "list", groupId] as const

export const fetchChannels = (groupId: string) =>
  api.get<ChannelItem[]>(`/api/groups/${groupId}/channels`)

/** #general first, then top-level channels in order, each with its sub-channels. */
export function channelTree(channels: ChannelItem[]): ChannelNode[] {
  const top = channels.filter((c) => !c.parentId)
  return top.map((c) => ({
    ...c,
    children: channels.filter((x) => x.parentId === c.id),
  }))
}

export const isChannelUnread = (c: ChannelItem) =>
  Boolean(c.lastMessageAt && c.lastReadAt && c.lastMessageAt > c.lastReadAt)

/** Same rules as the server's `normalizeChannelName`, for a live preview. */
export function normalizeChannelName(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
}

/** My ACTIVE groups for the sidebar, the default ("All company") group first. */
export const myGroupsKey = (meId: string) =>
  ["groupMember", "findMany", "sidebar", meId] as const

export const fetchMyGroups = (meId: string) =>
  db.groupMember.findMany({
    where: { userId: meId, status: "ACTIVE" },
    orderBy: [{ group: { isDefault: "desc" } }, { group: { name: "asc" } }],
    select: {
      role: true,
      group: {
        select: {
          id: true,
          name: true,
          slug: true,
          isDefault: true,
          coverUrl: true,
        },
      },
    },
  })

export type MyGroup = Awaited<ReturnType<typeof fetchMyGroups>>[number]

export const canModerate = (role: string | undefined, isAdmin: boolean) =>
  isAdmin || role === "ADMIN" || role === "MODERATOR"

// ── integrations ─────────────────────────────────────────────────────

export type IntegrationKind =
  "INCOMING_WEBHOOK" | "OUTGOING_WEBHOOK" | "BOT_TOKEN"

export type Integration = {
  id: string
  channelId: string
  kind: IntegrationKind
  name: string
  avatarUrl: string | null
  enabled: boolean
  secretHint: string
  allowedIps: string[]
  allowedHosts: string[]
  targetUrl: string | null
  triggerWords: string[]
  rateLimitPerMin: number
  lastUsedAt: Date | null
  createdAt: Date
}

export const integrationsKey = (channelId: string) =>
  ["channelIntegration", "findMany", channelId] as const

export const fetchIntegrations = (channelId: string) =>
  db.channelIntegration.findMany({
    where: { channelId },
    orderBy: { createdAt: "asc" },
  }) as Promise<Integration[]>

export const deliveriesKey = (integrationId: string) =>
  ["integrationDelivery", "findMany", integrationId] as const

export const fetchDeliveries = (integrationId: string) =>
  db.integrationDelivery.findMany({
    where: { integrationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

export const KIND_LABEL: Record<IntegrationKind, string> = {
  INCOMING_WEBHOOK: "Incoming webhook",
  OUTGOING_WEBHOOK: "Outgoing webhook",
  BOT_TOKEN: "Bot token",
}

export const KIND_DESCRIPTION: Record<IntegrationKind, string> = {
  INCOMING_WEBHOOK: "Post messages into this channel from another service.",
  OUTGOING_WEBHOOK:
    "Send new messages (or ones starting with a trigger word) to your URL; reply with { text } to answer.",
  BOT_TOKEN:
    "A token scripts use to read and post in this channel through the bot API.",
}
