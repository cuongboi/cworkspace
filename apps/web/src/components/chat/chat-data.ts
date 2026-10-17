import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { db } from "@/lib/api-client"
import type { ReactionType } from "@app/api/zenstack/models"

/**
 * Chat queries, cache keys and cache helpers. Every key starts with the model delegate name so
 * `useRealtimeSync` invalidations reach it.
 */

const userSummary = { select: { id: true, name: true, image: true } } as const

// ── conversation list ────────────────────────────────────────────────

export const conversationListKey = (orgId: string) =>
  ["conversationMember", "findMany", "chat-list", orgId] as const

/** My memberships in this org (read state + mute) with the conversation, members and last message. */
export function fetchConversationList(orgId: string, meId: string) {
  return db.conversationMember.findMany({
    where: { userId: meId, conversation: { organizationId: orgId } },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: 100,
    select: {
      id: true,
      lastReadAt: true,
      mutedUntil: true,
      conversation: {
        select: {
          id: true,
          type: true,
          title: true,
          lastMessageAt: true,
          members: {
            select: { userId: true, user: userSummary },
            orderBy: { joinedAt: "asc" },
          },
          messages: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              id: true,
              content: true,
              type: true,
              senderId: true,
              deletedAt: true,
              data: true,
              _count: { select: { attachments: true } },
            },
          },
        },
      },
    },
  })
}

export type ConversationListItem = Awaited<
  ReturnType<typeof fetchConversationList>
>[number]

// ── one conversation ─────────────────────────────────────────────────

export const conversationKey = (id: string) =>
  ["conversation", "findUnique", "chat", id] as const

export function fetchConversation(id: string) {
  return db.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      type: true,
      title: true,
      createdById: true,
    },
  })
}

export type ThreadConversation = NonNullable<
  Awaited<ReturnType<typeof fetchConversation>>
>

export const membersKey = (conversationId: string) =>
  ["conversationMember", "findMany", "chat", conversationId] as const

export function fetchMembers(conversationId: string) {
  return db.conversationMember.findMany({
    where: { conversationId },
    orderBy: { joinedAt: "asc" },
    select: {
      id: true,
      userId: true,
      role: true,
      lastReadAt: true,
      mutedUntil: true,
      user: userSummary,
    },
  })
}

export type ThreadMember = Awaited<ReturnType<typeof fetchMembers>>[number]

// ── messages ─────────────────────────────────────────────────────────

export const MESSAGE_PAGE_SIZE = 30

export const messageInclude = {
  sender: userSummary,
  attachments: {
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      width: true,
      height: true,
    },
  },
  reactions: {
    select: {
      id: true,
      userId: true,
      type: true,
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  replyTo: {
    select: {
      id: true,
      content: true,
      deletedAt: true,
      senderId: true,
      sender: { select: { name: true } },
    },
  },
} as const

export const messagesKey = (conversationId: string) =>
  ["message", "thread", conversationId] as const

export function fetchMessages(
  conversationId: string,
  cursor: string | undefined
) {
  return db.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGE_PAGE_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: messageInclude,
  })
}

export function fetchMessage(id: string) {
  return db.message.findUnique({ where: { id }, include: messageInclude })
}

export type ThreadMessage = Awaited<ReturnType<typeof fetchMessages>>[number]
/** A message in the thread cache; `pending` marks an optimistic message not yet saved. */
export type ChatMessage = ThreadMessage & { pending?: boolean }

type MessagePages = InfiniteData<ChatMessage[], string | undefined>

const isTemp = (id: string) => id.startsWith("temp-")
export const tempId = () =>
  `temp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function updatePages(
  qc: QueryClient,
  conversationId: string,
  fn: (pages: ChatMessage[][]) => ChatMessage[][]
) {
  qc.setQueryData<MessagePages>(messagesKey(conversationId), (old) =>
    old ? { ...old, pages: fn(old.pages) } : old
  )
}

const hasId = (pages: ChatMessage[][], id: string) =>
  pages.some((p) => p.some((m) => m.id === id))

/**
 * Inserts a new message at the newest end. Dedupes by id, and a server echo of my own optimistic
 * message replaces the temp entry (matched by sender + content) instead of duplicating it.
 */
export function insertMessage(qc: QueryClient, message: ChatMessage) {
  updatePages(qc, message.conversationId, (pages) => {
    if (hasId(pages, message.id)) return pages
    if (!message.pending) {
      let replaced = false
      const next = pages.map((page) =>
        page.map((m) => {
          if (replaced || !m.pending || !isTemp(m.id)) return m
          if (m.senderId !== message.senderId || m.content !== message.content)
            return m
          replaced = true
          // keep the optimistic attachments / quote until the full row arrives
          return {
            ...m,
            ...message,
            attachments: m.attachments,
            replyTo: m.replyTo,
            pending: false,
          }
        })
      )
      if (replaced) return next
    }
    const [first = [], ...rest] = pages
    return [[message, ...first], ...rest]
  })
}

/** Replaces the message with `id` (no-op when it isn't cached). */
export function replaceMessage(
  qc: QueryClient,
  conversationId: string,
  id: string,
  message: ChatMessage
) {
  updatePages(qc, conversationId, (pages) => {
    if (id !== message.id && hasId(pages, message.id)) {
      // the realtime echo already reconciled it: just drop the temp
      return pages.map((page) => page.filter((m) => m.id !== id))
    }
    if (!hasId(pages, id)) {
      const [first = [], ...rest] = pages
      return [[message, ...first], ...rest]
    }
    return pages.map((page) => page.map((m) => (m.id === id ? message : m)))
  })
}

export function patchMessage(
  qc: QueryClient,
  conversationId: string,
  id: string,
  patch: (m: ChatMessage) => ChatMessage
) {
  updatePages(qc, conversationId, (pages) =>
    pages.map((page) => page.map((m) => (m.id === id ? patch(m) : m)))
  )
}

export function removeMessage(
  qc: QueryClient,
  conversationId: string,
  id: string
) {
  updatePages(qc, conversationId, (pages) =>
    pages.map((page) => page.filter((m) => m.id !== id))
  )
}

export function findCachedMessage(
  qc: QueryClient,
  conversationId: string,
  id: string
) {
  const data = qc.getQueryData<MessagePages>(messagesKey(conversationId))
  return data?.pages.flat().find((m) => m.id === id)
}

// ── display helpers ──────────────────────────────────────────────────

type UserLike = { id: string; name: string; image: string | null }

/** Members other than me (falls back to everyone for a conversation with only me). */
export function otherUsers(
  members: { userId: string; user: UserLike }[],
  meId: string
) {
  const others = members.filter((m) => m.userId !== meId).map((m) => m.user)
  return others.length ? others : members.map((m) => m.user)
}

export function conversationTitle(
  conversation: { type: "DIRECT" | "GROUP"; title: string | null },
  members: { userId: string; user: UserLike }[],
  meId: string
) {
  const others = otherUsers(members, meId)
  if (conversation.type === "DIRECT") return others[0]?.name ?? "Conversation"
  if (conversation.title?.trim()) return conversation.title.trim()
  const names = others.map((u) => u.name.split(/\s+/)[0] ?? u.name)
  if (names.length === 0) return "Just you"
  if (names.length <= 3) return names.join(", ")
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`
}

export const REACTIONS: { type: ReactionType; emoji: string; label: string }[] =
  [
    { type: "LIKE", emoji: "👍", label: "Like" },
    { type: "LOVE", emoji: "❤️", label: "Love" },
    { type: "HAHA", emoji: "😆", label: "Haha" },
    { type: "WOW", emoji: "😮", label: "Wow" },
    { type: "SAD", emoji: "😢", label: "Sad" },
    { type: "ANGRY", emoji: "😡", label: "Angry" },
  ]

export const reactionEmoji = (type: ReactionType) =>
  REACTIONS.find((r) => r.type === type)?.emoji ?? "👍"

export type CallData = {
  callId?: string
  callType: "AUDIO" | "VIDEO"
  durationSec: number
  answered: boolean
}

export function parseCallData(data: unknown): CallData {
  const d = (data && typeof data === "object" ? data : {}) as Record<
    string,
    unknown
  >
  return {
    callId: typeof d.callId === "string" ? d.callId : undefined,
    callType: d.callType === "VIDEO" ? "VIDEO" : "AUDIO",
    durationSec: typeof d.durationSec === "number" ? d.durationSec : 0,
    answered: d.answered === true,
  }
}

export function formatDuration(sec: number) {
  if (sec < 60) return `${Math.max(0, Math.round(sec))} sec`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${min % 60} min`
}

export function callLabel(data: CallData) {
  const kind = data.callType === "VIDEO" ? "Video call" : "Audio call"
  return data.answered
    ? `${kind} · ${formatDuration(data.durationSec)}`
    : `Missed ${kind.toLowerCase()}`
}
