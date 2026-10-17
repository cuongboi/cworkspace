import { useQueryClient } from "@tanstack/react-query"
import {
  ChevronRightIcon,
  HistoryIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { TimeAgo } from "@/components/common/time-ago"
import { UserAvatar } from "@/components/common/user-avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ApiError, db } from "@/lib/api-client"
import { invalidateModels } from "@/lib/query"
import { Markdown } from "./markdown"
import { WikiHistorySheet } from "./wiki-history-sheet"
import type { WikiPageDetail, WikiTreeRow } from "./wiki-query"

export function WikiPageView({
  page,
  ancestors,
  canEdit,
  canDelete,
  onSelect,
  onEdit,
  onDeleted,
}: {
  page: WikiPageDetail
  ancestors: WikiTreeRow[]
  canEdit: boolean
  canDelete: boolean
  onSelect: (id: string) => void
  onEdit: () => void
  onDeleted: (parentId: string | null) => void
}) {
  const qc = useQueryClient()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const lastEdit = page.revisions[0]
  const editor = lastEdit?.author ?? page.createdBy
  const subpages = page._count.children

  const remove = async () => {
    try {
      await db.wikiPage.delete({ where: { id: page.id }, select: { id: true } })
      await invalidateModels(qc, ["wikiPage", "wikiRevision"])
      toast.success("Page deleted")
      onDeleted(page.parentId)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete")
    }
  }

  return (
    <article className="flex flex-col gap-4">
      {ancestors.length ? (
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
        >
          {ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <button
                type="button"
                className="hover:text-foreground hover:underline"
                onClick={() => onSelect(a.id)}
              >
                {a.title}
              </button>
              <ChevronRightIcon className="size-3" aria-hidden />
            </span>
          ))}
        </nav>
      ) : null}

      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold tracking-tight break-words">
            {page.title}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserAvatar user={editor} size="sm" className="size-5" />
            {lastEdit ? "Edited" : "Created"} by {editor.name} ·{" "}
            <TimeAgo date={lastEdit?.createdAt ?? page.createdAt} />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHistoryOpen(true)}
          >
            <HistoryIcon /> History
          </Button>
          {canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2Icon /> Delete
            </Button>
          ) : null}
          {canEdit ? (
            <Button size="sm" onClick={onEdit}>
              <PencilIcon /> Edit
            </Button>
          ) : null}
        </div>
      </header>

      {page.content.trim() ? (
        <Markdown>{page.content}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          This page is empty.{canEdit ? " Click Edit to write it." : ""}
        </p>
      )}

      <WikiHistorySheet
        page={page}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canEdit={canEdit}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{page.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {subpages
                ? `Its ${subpages} subpage${subpages === 1 ? "" : "s"} and all their history will be deleted too. `
                : "Its history will be deleted too. "}
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void remove()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
