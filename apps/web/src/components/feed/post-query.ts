import { db } from "@/lib/api-client"
import type {
  CommentGetPayload,
  CommentInclude,
  PostGetPayload,
  PostInclude,
  PostWhereInput,
} from "@app/api/zenstack/input"

/**
 * Shared shape of a post in every feed (home, group, profile, search, permalink), so one
 * `PostCard` renders them all. `meId` narrows the nested rows that are only about me.
 */
export function postInclude(meId: string) {
  return {
    author: { select: { id: true, name: true, image: true, title: true } },
    group: {
      select: {
        id: true,
        name: true,
        slug: true,
        privacy: true,
        isDefault: true,
        members: {
          where: { userId: meId, status: "ACTIVE" },
          select: { role: true },
        },
      },
    },
    attachments: {
      select: {
        id: true,
        name: true,
        mimeType: true,
        size: true,
        width: true,
        height: true,
      },
      orderBy: { createdAt: "asc" },
    },
    poll: {
      select: {
        id: true,
        question: true,
        allowMultiple: true,
        closesAt: true,
        options: {
          select: {
            id: true,
            text: true,
            order: true,
            _count: { select: { votes: true } },
          },
          orderBy: { order: "asc" },
        },
        votes: { select: { optionId: true, userId: true } },
      },
    },
    event: {
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        startAt: true,
        endAt: true,
        allDay: true,
        location: true,
        hasVideoCall: true,
        attendees: {
          select: {
            userId: true,
            rsvp: true,
            user: { select: { id: true, name: true, image: true } },
          },
        },
      },
    },
    reactions: {
      select: {
        type: true,
        userId: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    },
    _count: { select: { comments: true } },
  } as const satisfies PostInclude
}

export type FeedPost = PostGetPayload<{
  include: ReturnType<typeof postInclude>
}>

export type PostCursorArgs = {
  where: PostWhereInput
  take?: number
  cursor?: string
}

/**
 * One page of posts, newest first, with the shared include. (Pinned posts are fetched
 * separately: cursor pagination over a nullable `pinnedAt` sort key doesn't work.)
 */
export function findPosts(
  meId: string,
  { where, take = 10, cursor }: PostCursorArgs
): Promise<FeedPost[]> {
  return db.post.findMany({
    where,
    include: postInclude(meId),
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  })
}

/** Pinned posts matching `where`, most recently pinned first. */
export function findPinnedPosts(
  meId: string,
  where: PostWhereInput
): Promise<FeedPost[]> {
  return db.post.findMany({
    where: { AND: [where, { pinnedAt: { not: null } }] },
    include: postInclude(meId),
    orderBy: [{ pinnedAt: "desc" }, { id: "desc" }],
    take: 20,
  })
}

export function commentInclude() {
  return {
    author: { select: { id: true, name: true, image: true } },
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
        type: true,
        userId: true,
        user: { select: { id: true, name: true } },
      },
    },
  } as const satisfies CommentInclude
}

export type FeedComment = CommentGetPayload<{
  include: ReturnType<typeof commentInclude>
}>

export function findComments(postId: string): Promise<FeedComment[]> {
  return db.comment.findMany({
    where: { postId },
    include: commentInclude(),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  })
}
