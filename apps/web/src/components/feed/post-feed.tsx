import { useVirtualizer } from "@tanstack/react-virtual"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useApp } from "@/hooks/use-app"
import { usePageScrollElement } from "@/hooks/use-page-scroll"
import { errorMessage } from "@/lib/i18n"
import { useDbInfinite, useDbQuery } from "@/lib/query"
import type { PostWhereInput } from "@app/api/zenstack/input"
import { PostCard, PostSkeleton } from "./post-card"
import { findPinnedPosts, findPosts } from "./post-query"

const PAGE_SIZE = 10
const POST_GAP = 16
/** start fetching the next page while this many posts are still below the rendered window */
const PREFETCH_ROWS = 3

/**
 * Infinite, virtualized list of posts. `scope` identifies the feed in the query key (keys start
 * with "post" so realtime events refresh it). It scrolls with the page (`PageScrollContext`), so
 * only cards near the viewport are mounted: local card state (open comments, drafts) resets once
 * a card scrolls far out of view.
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
  const { t } = useTranslation()
  const { me } = useApp()
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

  const posts = [
    ...(pinnedFirst ? (pinned.data ?? []) : []),
    ...(data?.pages.flat() ?? []),
  ]

  const scrollElement = usePageScrollElement()
  const [list, setList] = useState<HTMLDivElement | null>(null)
  const scrollMargin = useListOffset(list, scrollElement)
  const virtualizer = useVirtualizer({
    count: posts.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 360,
    getItemKey: (i) => posts[i]?.id ?? i,
    gap: POST_GAP,
    overscan: 3,
    scrollMargin,
  })
  const items = virtualizer.getVirtualItems()

  const lastRendered = items.at(-1)?.index ?? -1
  useEffect(() => {
    if (
      posts.length > 0 &&
      lastRendered >= posts.length - PREFETCH_ROWS &&
      hasNextPage &&
      !isFetchingNextPage
    )
      void fetchNextPage()
  }, [
    lastRendered,
    posts.length,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ])

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
          {errorMessage(error) || t("feed.loadFailed")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    )
  }

  if (posts.length === 0) return <>{empty}</>

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={setList}
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const post = posts[item.index]
          if (!post) return null
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0 top-0"
              style={{
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <PostCard post={post} showGroup={showGroup} />
            </div>
          )
        })}
      </div>
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
          {t("common.loadMore")}
        </Button>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t("feed.caughtUp")}
        </p>
      )}
    </div>
  )
}

/**
 * Distance from the top of the scroll content to the list (the virtualizer's `scrollMargin`).
 * Content above the list (composer, group header, banners) changes size, so it is re-read
 * whenever the scroll content resizes.
 */
function useListOffset(
  list: HTMLElement | null,
  scrollElement: HTMLElement | null
) {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const content = scrollElement?.firstElementChild
    if (!list || !scrollElement || !content) return
    // fires once on observe, then on every resize
    const observer = new ResizeObserver(() => {
      const next =
        list.getBoundingClientRect().top -
        scrollElement.getBoundingClientRect().top +
        scrollElement.scrollTop
      setOffset((prev) => (Math.abs(prev - next) < 1 ? prev : next))
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [list, scrollElement])

  return offset
}
