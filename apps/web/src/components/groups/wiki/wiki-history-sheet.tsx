import { useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import { format } from "date-fns"
import { useState } from "react"
import { toast } from "sonner"
import { TimeAgo } from "@/components/common/time-ago"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ApiError, db } from "@/lib/api-client"
import { invalidateModels, useDbQuery } from "@/lib/query"
import { Markdown } from "./markdown"
import {
  fetchWikiRevisions,
  type WikiPageDetail,
  wikiRevisionsKey,
} from "./wiki-query"
import { ScrollArea } from "@/components/ui/scroll-area"

/** Revision list with a preview; restoring saves the old content as a new revision. */
export function WikiHistorySheet({
  page,
  open,
  onOpenChange,
  canEdit,
}: {
  page: WikiPageDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit: boolean
}) {
  const qc = useQueryClient()
  const { data: revisions, isPending } = useDbQuery(
    wikiRevisionsKey(page.id),
    () => fetchWikiRevisions(page.id),
    { enabled: open }
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const selected =
    revisions?.find((r) => r.id === selectedId) ?? revisions?.[0] ?? null
  const isCurrent = selected?.id === revisions?.[0]?.id

  const restore = async () => {
    if (!selected) return
    setRestoring(true)
    try {
      await db.wikiPage.update({
        where: { id: page.id, version: page.version },
        data: {
          title: selected.title,
          content: selected.content,
          version: { increment: 1 },
          revisions: {
            create: { title: selected.title, content: selected.content },
          },
        },
        select: { id: true },
      })
      await invalidateModels(qc, ["wikiPage", "wikiRevision"])
      toast.success(
        `Restored the version from ${format(selected.createdAt, "PPp")}`
      )
      setSelectedId(null)
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === "NOT_FOUND"
          ? "The page changed meanwhile. Reopen the history and try again."
          : err instanceof ApiError
            ? err.message
            : "Could not restore"
      )
      await invalidateModels(qc, ["wikiPage", "wikiRevision"])
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle>Page history</SheetTitle>
          <SheetDescription>
            {revisions
              ? `${revisions.length}${revisions.length === 100 ? "+" : ""} versions of “${page.title}”`
              : "Loading versions…"}
          </SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[16rem_1fr]">
          <ScrollArea
            className="min-h-0 border-b md:border-r md:border-b-0"
            viewportClassName="max-h-48 md:max-h-none"
          >
            <ul className="p-2">
              {isPending
                ? Array.from({ length: 4 }, (_, i) => (
                    <li key={i} className="p-2">
                      <Skeleton className="h-9 w-full" />
                    </li>
                  ))
                : revisions?.map((r, i) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-accent",
                          selected?.id === r.id && "bg-accent"
                        )}
                      >
                        <UserAvatar user={r.author} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {r.author.name}
                            {i === 0 ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · current
                              </span>
                            ) : null}
                          </span>
                          <TimeAgo
                            date={r.createdAt}
                            className="block text-xs text-muted-foreground"
                          />
                        </span>
                      </button>
                    </li>
                  ))}
            </ul>
          </ScrollArea>
          <div className="flex min-h-0 flex-col">
            {selected ? (
              <>
                <div className="flex items-center gap-2 border-b px-4 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {format(selected.createdAt, "PPpp")}
                  </span>
                  {canEdit && !isCurrent ? (
                    <Button
                      size="sm"
                      onClick={() => void restore()}
                      disabled={restoring}
                    >
                      {restoring ? <Spinner /> : null}
                      Restore this version
                    </Button>
                  ) : null}
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="p-4">
                    <h2 className="mb-4 text-xl font-bold">{selected.title}</h2>
                    <Markdown>{selected.content || "_Empty page_"}</Markdown>
                  </div>
                </ScrollArea>
              </>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
