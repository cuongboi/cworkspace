import type { InfiniteData, QueryClient } from "@tanstack/react-query"
import { db } from "@/lib/api-client"
import i18n from "@/lib/i18n"
import type { ReactionType } from "@app/api/zenstack/models"

/**
 * Chat queries, cache keys and cache helpers. Every key starts with the model delegate name so
 * `useRealtimeSync` invalidations reach it.
 */

const userSummary = { select: { id: true, name: true, image: true } } as const
/** set on a group's chat: its title and avatar come from the group */
const groupSummary = {
  select: { id: true, name: true, slug: true, coverUrl: true },
} as const

// ── conversation list ────────────────────────────────────────────────

export const conversationListKey = () =>
  ["conversationMember", "findMany", "chat-list"] as const

/** My memberships (read state + mute) with the conversation, members and last message. */
export function fetchConversationList(meId: string) {
  return db.conversationMember.findMany({
    // group and channel chats live under Groups
    where: { userId: meId, conversation: { groupId: null, channelId: null } },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: 100,
    select: {
      id: true,
      lastReadAt: true,
      mutedUntil: true,
      favoritedAt: true,
      conversation: {
        select: {
          id: true,
          type: true,
          title: true,
          group: groupSummary,
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
      type: true,
      title: true,
      createdById: true,
      createdAt: true,
      channelId: true,
      createdBy: { select: { id: true, name: true } },
      group: groupSummary,
    },
  })
}

export const conversationFilesKey = (conversationId: string) =>
  ["attachment", "findMany", "chat-files", conversationId] as const

/** Files shared in a conversation, newest first (details panel). */
export function fetchConversationFiles(conversationId: string) {
  return db.attachment.findMany({
    where: { message: { conversationId, deletedAt: null } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      createdAt: true,
      uploader: { select: { name: true } },
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
  /** BOT messages render as the integration, not its creator */
  integration: { select: { id: true, name: true, avatarUrl: true } },
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
  /** CHANNEL thread roots: the latest repliers (avatar stack under the root) */
  threadReplies: {
    select: { id: true, sender: userSummary },
    orderBy: { createdAt: "desc" },
    take: 10,
  },
} as const

export const messagesKey = (conversationId: string) =>
  ["message", "thread", conversationId] as const

export function fetchMessages(
  conversationId: string,
  cursor: string | undefined
) {
  return db.message.findMany({
    // thread replies live in the thread panel unless also sent to the channel
    where: {
      conversationId,
      OR: [{ threadId: null }, { alsoSentToChannel: true }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGE_PAGE_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: messageInclude,
  })
}

export const threadRepliesKey = (rootId: string) =>
  ["message", "thread-replies", rootId] as const

/** A CHANNEL thread's replies, oldest first. */
export function fetchThreadReplies(rootId: string) {
  return db.message.findMany({
    where: { threadId: rootId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    include: messageInclude,
  })
}

export const messageSearchKey = (conversationId: string, q: string) =>
  ["message", "search", conversationId, q] as const

/** Full-text match on whole words, plus a substring match for partial words. */
/** Full-text match (index-backed) plus a substring fallback for partial words. */
export function messageSearchWhere(q: string) {
  return {
    deletedAt: null,
    type: { in: ["TEXT", "BOT"] as ("TEXT" | "BOT")[] },
    OR: [
      { content: { fts: { search: q, config: "simple" as const } } },
      { content: { contains: q, mode: "insensitive" as const } },
    ],
  }
}

export function searchMessages(
  conversationId: string,
  q: string,
  cursor: string | undefined
) {
  return db.message.findMany({
    where: {
      conversationId,
      ...messageSearchWhere(q),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGE_PAGE_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      content: true,
      createdAt: true,
      sender: { select: { id: true, name: true, image: true } },
    },
  })
}

export type MessageSearchHit = Awaited<
  ReturnType<typeof searchMessages>
>[number]

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

function updateThread(
  qc: QueryClient,
  rootId: string,
  fn: (replies: ChatMessage[]) => ChatMessage[]
) {
  qc.setQueryData<ChatMessage[]>(threadRepliesKey(rootId), (old) =>
    old ? fn(old) : old
  )
}

/** Applies `fn` to every cached thread (edits/reactions/unsend from the thread panel). */
function updateAllThreads(
  qc: QueryClient,
  fn: (replies: ChatMessage[]) => ChatMessage[]
) {
  qc.setQueriesData<ChatMessage[]>(
    { queryKey: ["message", "thread-replies"] },
    (old) => (old ? fn(old) : old)
  )
}

/** Swaps my optimistic message for its server echo (same sender + content). */
function reconcile(list: ChatMessage[], message: ChatMessage) {
  let replaced = false
  const next = list.map((m) => {
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
  return replaced ? next : null
}

/**
 * Inserts a new message at the newest end. Dedupes by id, and a server echo of my own optimistic
 * message replaces the temp entry (matched by sender + content) instead of duplicating it.
 */
export function insertMessage(qc: QueryClient, message: ChatMessage) {
  if (message.threadId) {
    updateThread(qc, message.threadId, (list) => {
      if (list.some((m) => m.id === message.id)) return list
      return (
        (!message.pending && reconcile(list, message)) || [...list, message]
      )
    })
    if (!message.alsoSentToChannel) return
  }
  updatePages(qc, message.conversationId, (pages) => {
    if (hasId(pages, message.id)) return pages
    if (!message.pending) {
      let next: ChatMessage[][] | null = null
      for (let i = 0; i < pages.length && !next; i++) {
        const page = reconcile(pages[i] ?? [], message)
        if (page) next = pages.map((p, j) => (j === i ? page : p))
      }
      if (next) return next
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
  if (message.threadId) {
    updateThread(qc, message.threadId, (list) => {
      if (id !== message.id && list.some((m) => m.id === message.id))
        return list.filter((m) => m.id !== id)
      if (!list.some((m) => m.id === id)) return [...list, message]
      return list.map((m) => (m.id === id ? message : m))
    })
    if (!message.alsoSentToChannel) return
  }
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
  updateAllThreads(qc, (list) => list.map((m) => (m.id === id ? patch(m) : m)))
}

export function removeMessage(
  qc: QueryClient,
  conversationId: string,
  id: string
) {
  updatePages(qc, conversationId, (pages) =>
    pages.map((page) => page.filter((m) => m.id !== id))
  )
  updateAllThreads(qc, (list) => list.filter((m) => m.id !== id))
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
  conversation: {
    type: "DIRECT" | "GROUP" | "CHANNEL"
    title: string | null
    group?: { name: string } | null
  },
  members: { userId: string; user: UserLike }[],
  meId: string
) {
  if (conversation.group) return conversation.group.name
  const others = otherUsers(members, meId)
  if (conversation.type === "DIRECT")
    return others[0]?.name ?? i18n.t("chat.conversation")
  if (conversation.title?.trim()) return conversation.title.trim()
  const names = others.map((u) => u.name.split(/\s+/)[0] ?? u.name)
  if (names.length === 0) return i18n.t("chat.justYou")
  if (names.length <= 3) return names.join(", ")
  return i18n.t("chat.namesAndOthers", {
    names: names.slice(0, 2).join(", "),
    count: names.length - 2,
  })
}

/** labels: `t(`chat.reactions.${type}`)` at render */
export const REACTIONS: { type: ReactionType; emoji: string }[] = [
  { type: "LIKE", emoji: "👍" },
  { type: "LOVE", emoji: "❤️" },
  { type: "HAHA", emoji: "😆" },
  { type: "WOW", emoji: "😮" },
  { type: "SAD", emoji: "😢" },
  { type: "ANGRY", emoji: "😡" },
]

export const reactionEmoji = (type: ReactionType) =>
  REACTIONS.find((r) => r.type === type)?.emoji ?? "👍"

export type CallData = {
  callId?: string
  callType: "AUDIO" | "VIDEO"
  durationSec: number
  answered: boolean
  /** a group's drop-in call: never "missed" */
  groupCall: boolean
  /** the group call is still running (its entry is updated when it ends) */
  live: boolean
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
    groupCall: d.groupCall === true,
    live: d.live === true,
  }
}

export function formatDuration(sec: number) {
  if (sec < 60)
    return i18n.t("chat.duration.sec", { count: Math.max(0, Math.round(sec)) })
  const min = Math.round(sec / 60)
  if (min < 60) return i18n.t("chat.duration.min", { count: min })
  const h = Math.floor(min / 60)
  return i18n.t("chat.duration.hourMin", { h, m: min % 60 })
}

export function callLabel(data: CallData) {
  const video = data.callType === "VIDEO"
  if (data.live)
    return i18n.t(
      video ? "chat.callMsg.videoInProgress" : "chat.callMsg.audioInProgress"
    )
  if (data.groupCall || data.answered)
    return i18n.t(video ? "chat.callMsg.video" : "chat.callMsg.audio", {
      duration: formatDuration(data.durationSec),
    })
  return i18n.t(video ? "chat.callMsg.missedVideo" : "chat.callMsg.missedAudio")
}
