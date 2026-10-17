import { type ReactNode, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useOrg } from "@/hooks/use-org"
import { useDbInfinite, useDbQuery } from "@/lib/query"
import type { PostWhereInput } from "@app/api/zenstack/input"
import { PostCard, PostSkeleton } from "./post-card"
import { findPinnedPosts, findPosts } from "./post-query"

const PAGE_SIZE = 10

/**
 * Infinite list of posts. `scope` identifies the feed in the query key (keys start with "post" so
 * realtime events refresh it).
 */
export function PostFeed({
  scope,
  where,
  pinnedFirst = false,
  showGroup = true,
  empty,
}: {
  scope: readonly unknown[]
  where: PostWhereInput
  pinnedFirst?: boolean
  showGroup?: boolean
  empty?: ReactNode
}) {
  const { me } = useOrg()
  const {
    data,
    isPending,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useDbInfinite(
    ["post", "findMany", "feed", ...scope],
    (cursor) =>
      findPosts(me.id, {
        where: pinnedFirst ? { AND: [where, { pinnedAt: null }] } : where,
        cursor,
        take: PAGE_SIZE,
      }),
    PAGE_SIZE
  )
  const pinned = useDbQuery(
    ["post", "findMany", "pinned", ...scope],
    () => findPinnedPosts(me.id, where),
    { enabled: pinnedFirst }
  )
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage)
          void fetchNextPage()
      },
      { rootMargin: "600px 0px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isPending || (pinnedFirst && pinned.isPending)) {
    return (
      <div className="flex flex-col gap-4">
        <PostSkeleton />
        <PostSkeleton />
        <PostSkeleton />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center text-sm">
        <p className="text-muted-foreground">
          {error.message || "Couldn't load posts."}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const posts = [
    ...(pinnedFirst ? (pinned.data ?? []) : []),
    ...data.pages.flat(),
  ]
  if (posts.length === 0) return <>{empty}</>

  return (
    <div className="flex flex-col gap-4">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} showGroup={showGroup} />
      ))}
      <div ref={sentinel} aria-hidden className="h-px" />
      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Spinner className="size-5" />
        </div>
      ) : hasNextPage ? (
        <Button
          variant="ghost"
          className="self-center"
          onClick={() => void fetchNextPage()}
        >
          Load more
        </Button>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">
          You're all caught up
        </p>
      )}
    </div>
  )
}
