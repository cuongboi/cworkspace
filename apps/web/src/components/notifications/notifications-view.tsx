import { useQueryClient } from "@tanstack/react-query"
import { BellIcon, CheckCheckIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { PageTitle } from "@/components/common/page-title"
import {
  NotificationItem,
  NotificationSkeleton,
  notificationInclude,
} from "@/components/notifications/notification-item"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { db } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { invalidateModels, useDbInfinite, useDbQuery } from "@/lib/query"

const PAGE_SIZE = 20
type Filter = "all" | "unread"

export function NotificationsView() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>("all")

  const { data: unread = 0 } = useDbQuery(
    ["notification", "count", "unread"],
    () =>
      db.notification.count({
        where: { readAt: null },
      })
  )

  const {
    data,
    isPending,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDbInfinite(
    ["notification", "findMany", "page", filter],
    (cursor) =>
      db.notification.findMany({
        where: {
          ...(filter === "unread" ? { readAt: null } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: notificationInclude,
        take: PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    PAGE_SIZE
  )
  const items = data?.pages.flat() ?? []

  // load the next page when the sentinel scrolls into view
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage)
          void fetchNextPage()
      },
      { rootMargin: "300px" }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const markAllRead = async () => {
    try {
      await db.notification.updateMany({
        where: { readAt: null },
        data: { readAt: new Date() },
      })
      await invalidateModels(queryClient, ["notification"])
    } catch (err) {
      toast.error(
        err instanceof Error
          ? errorMessage(err)
          : t("notifications.markAllFailed")
      )
    }
  }

  return (
    <>
      <PageTitle title={t("notifications.title")} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={unread === 0}
          >
            <CheckCheckIcon />
            {t("notifications.markAllRead")}
          </Button>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          aria-label={t("notifications.filterLabel")}
        >
          <ToggleGroupItem value="all" className="px-4">
            {t("notifications.all")}
          </ToggleGroupItem>
          <ToggleGroupItem value="unread" className="px-4">
            {t("notifications.unread")}
            {unread > 0 ? ` (${unread > 99 ? "99+" : unread})` : ""}
          </ToggleGroupItem>
        </ToggleGroup>
        <Card className="py-2">
          <CardContent className="flex flex-col gap-0.5 px-2">
            {isPending ? (
              Array.from({ length: 6 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                <NotificationSkeleton key={i} />
              ))
            ) : isError ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t("notifications.loadFailed")}</EmptyTitle>
                  <EmptyDescription>{errorMessage(error)}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : items.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <BellIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {filter === "unread"
                      ? t("notifications.noUnread")
                      : t("notifications.none")}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t("notifications.noneBody")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                {items.map((n) => (
                  <NotificationItem key={n.id} notification={n} />
                ))}
                <div ref={sentinel} />
                {hasNextPage ? (
                  <Button
                    variant="ghost"
                    className="mt-1"
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? <Spinner /> : null}
                    {t("common.loadMore")}
                  </Button>
                ) : items.length > PAGE_SIZE ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    {t("notifications.end")}
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
