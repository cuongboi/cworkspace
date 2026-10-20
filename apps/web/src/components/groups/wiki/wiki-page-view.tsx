import { useQueryClient } from "@tanstack/react-query"
import {
  DownloadIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { db } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { invalidateModels } from "@/lib/query"
import { Markdown } from "./markdown"
import { exportHtml, exportMarkdown, exportPdf } from "./wiki-export"
import { WikiHistorySheet } from "./wiki-history-sheet"
import { WikiOutline } from "./wiki-outline"
import { WikiTopBar } from "./wiki-top-bar"
import type { WikiPageDetail, WikiTreeRow } from "./wiki-query"
import { useIsMobile } from "@/hooks/use-mobile"

export function WikiPageView({
  page,
  ancestors,
  canEdit,
  canDelete,
  onSelect,
  onEdit,
  onDeleted,
  groupName,
  leading,
}: {
  groupName: string
  /** e.g. the page-tree toggle on mobile */
  leading?: ReactNode
  page: WikiPageDetail
  ancestors: WikiTreeRow[]
  canEdit: boolean
  canDelete: boolean
  onSelect: (id: string | null) => void
  onEdit: () => void
  onDeleted: (parentId: string | null) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const lastEdit = page.revisions[0]
  const editor = lastEdit?.author ?? page.createdBy
  const subpages = page._count.children

  const remove = async () => {
    try {
      await db.wikiPage.delete({ where: { id: page.id }, select: { id: true } })
      await invalidateModels(qc, ["wikiPage", "wikiRevision"])
      toast.success(t("wiki.page.deleted"))
      onDeleted(page.parentId)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <article className="flex h-full min-h-0 flex-col">
      <WikiTopBar
        leading={leading}
        groupName={groupName}
        ancestors={ancestors}
        title={page.title}
        onSelect={onSelect}
      >
        {canEdit ? (
          <Button
            size="sm"
            variant={isMobile ? "ghost" : "outline"}
            onClick={onEdit}
          >
            <PencilIcon />
            {!isMobile && t("common.edit")}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("wiki.page.moreActions")}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
              <HistoryIcon /> {t("wiki.page.history")}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DownloadIcon /> {t("wiki.page.export")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => exportMarkdown(page)}>
                  Markdown (.md)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportHtml(page)}>
                  {t("wiki.page.exportHtml")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportPdf(page)}>
                  {t("wiki.page.exportPdf")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setConfirmDelete(true)}
                >
                  <Trash2Icon /> {t("common.delete")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </WikiTopBar>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-8 md:px-10 xl:grid-cols-[minmax(0,1fr)_13rem]">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight break-words">
              {page.title}
            </h1>
            <div className="mt-2 mb-8 flex items-center gap-2 text-xs text-muted-foreground">
              <UserAvatar user={editor} size="sm" />
              <span>
                {t(lastEdit ? "wiki.page.editedBy" : "wiki.page.createdBy", {
                  name: editor.name,
                })}
              </span>
              <span>·</span>
              <TimeAgo date={lastEdit?.createdAt ?? page.createdAt} />
            </div>
            <div ref={bodyRef}>
              {page.content.trim() ? (
                <Markdown className="text-[15px]">{page.content}</Markdown>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {t("wiki.page.empty")}
                  {canEdit ? ` ${t("wiki.page.emptyEditHint")}` : ""}
                </p>
              )}
            </div>
          </div>
          <aside className="hidden self-start xl:sticky xl:top-8 xl:block">
            <WikiOutline bodyRef={bodyRef} content={page.content} />
          </aside>
        </div>
      </ScrollArea>

      <WikiHistorySheet
        page={page}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canEdit={canEdit}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("wiki.page.deleteTitle", { title: page.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {subpages
                ? t("wiki.page.deleteSubpages", { count: subpages })
                : t("wiki.page.deleteHistory")}{" "}
              {t("wiki.page.cannotUndo")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void remove()}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
