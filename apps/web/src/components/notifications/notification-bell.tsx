import { useQueryClient } from "@tanstack/react-query"
import { BellIcon, CheckCheckIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSocketEvent } from "@/hooks/use-socket"
import { db } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { invalidateModels, useDbQuery } from "@/lib/query"
import {
  describeNotification,
  NotificationItem,
  NotificationSkeleton,
  notificationInclude,
  resolveNotificationHref,
} from "./notification-item"
import { ScrollArea } from "@/components/ui/scroll-area"

const LATEST = 15

/** Header bell: unread badge, latest notifications in a popover, live toasts. */
export function NotificationBell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const { data: unread = 0 } = useDbQuery(
    ["notification", "count", "unread"],
    () =>
      db.notification.count({
        where: { readAt: null },
      })
  )

  // live toast for new notifications (cache refresh is done by useRealtimeSync)
  useSocketEvent("notification:new", (n) => {
    if (open) return
    toast(<span className="text-sm">{describeNotification(n)}</span>, {
      id: n.id,
      action: {
        label: t("notifications.view"),
        onClick: () => {
          void db.notification
            .update({ where: { id: n.id }, data: { readAt: new Date() } })
            .catch(() => undefined)
          void resolveNotificationHref(n).then((url) => navigate(url))
        },
      },
    })
  })

  const label =
    unread > 0
      ? t("notifications.bellLabel", { count: unread })
      : t("notifications.title")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={label}
            >
              <BellIcon />
              {unread > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-2xs font-semibold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("notifications.title")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className="flex w-[min(24rem,calc(100vw-1rem))] flex-col gap-0 p-0"
      >
        {open ? (
          <BellPanel unread={unread} onNavigate={() => setOpen(false)} />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function BellPanel({
  unread,
  onNavigate,
}: {
  unread: number
  onNavigate: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: items, isPending } = useDbQuery(
    ["notification", "findMany", "latest"],
    () =>
      db.notification.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: notificationInclude,
        take: LATEST,
      })
  )

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
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-base font-semibold">{t("notifications.title")}</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void markAllRead()}
          disabled={unread === 0}
        >
          <CheckCheckIcon />
          {t("notifications.markAllRead")}
        </Button>
      </div>
      <Separator />
      <ScrollArea viewportClassName="max-h-[min(28rem,calc(100svh-10rem))] overscroll-contain">
        <div className="flex flex-col gap-0.5 p-2">
          {isPending ? (
            Array.from({ length: 4 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
              <NotificationSkeleton key={i} />
            ))
          ) : !items?.length ? (
            <Empty className="p-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellIcon />
                </EmptyMedia>
                <EmptyTitle>{t("notifications.caughtUp")}</EmptyTitle>
                <EmptyDescription>
                  {t("notifications.caughtUpBody")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            items.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onNavigate={onNavigate}
              />
            ))
          )}
        </div>
      </ScrollArea>
      <Separator />
      <Button variant="ghost" className="m-1 rounded-md" asChild>
        <Link to={"/notifications"} onClick={onNavigate}>
          {t("common.seeAll")}
        </Link>
      </Button>
    </>
  )
}
