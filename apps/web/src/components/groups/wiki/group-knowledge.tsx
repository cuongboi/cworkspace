import {
  BookOpenIcon,
  FileQuestionIcon,
  ListTreeIcon,
  PlusIcon,
} from "lucide-react"
import { parseAsStringLiteral, useQueryState } from "nuqs"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import { useDbQuery } from "@/lib/query"
import type { GroupWithMe } from "../group-query"
import { WikiEditor } from "./wiki-editor"
import { WikiPageView } from "./wiki-page-view"
import {
  ancestorsOf,
  buildTree,
  fetchWikiPage,
  fetchWikiTree,
  useCanDeleteWikiPage,
  useCanEditWiki,
  wikiPageKey,
  wikiTreeKey,
} from "./wiki-query"
import { WikiTree } from "./wiki-tree"
import { ScrollArea } from "@/components/ui/scroll-area"

const MODES = ["edit", "new"] as const

/**
 * The group's Knowledge base: page tree | page (view, edit, or a new page). The open page, the mode
 * and the new page's parent live in the URL (`?page=`, `?wiki=edit|new`, `?parent=`).
 */
export function GroupKnowledge({ group }: { group: GroupWithMe }) {
  const isMobile = useIsMobile()
  const canEdit = useCanEditWiki(group)
  const [pageParam, setPageParam] = useQueryState("page")
  const [mode, setMode] = useQueryState("wiki", parseAsStringLiteral(MODES))
  const [parentParam, setParentParam] = useQueryState("parent")
  const [treeOpen, setTreeOpen] = useState(false)

  const tree = useDbQuery(wikiTreeKey(group.id), () => fetchWikiTree(group.id))
  const rows = tree.data ?? []
  // no page picked: open the first top-level page
  const pageId = pageParam ?? buildTree(rows)[0]?.id ?? null
  const page = useDbQuery(
    wikiPageKey(pageId ?? ""),
    () => fetchWikiPage(pageId ?? ""),
    { enabled: Boolean(pageId) && mode !== "new" }
  )
  const canDelete = useCanDeleteWikiPage(group, page.data?.createdBy.id)

  const select = (id: string | null) => {
    void setPageParam(id)
    void setMode(null)
    void setParentParam(null)
    setTreeOpen(false)
  }
  const startNew = (parentId: string | null) => {
    void setMode("new")
    void setParentParam(parentId)
    setTreeOpen(false)
  }

  const treePanel = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold">Pages</h2>
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New page"
            onClick={() => startNew(null)}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      {tree.isPending ? (
        <div className="flex flex-col gap-2 px-1">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : rows.length ? (
        <WikiTree
          groupId={group.id}
          rows={rows}
          activeId={mode === "new" ? null : pageId}
          canEdit={canEdit}
          onSelect={select}
          onNewChild={startNew}
        />
      ) : (
        <p className="px-1 text-xs text-muted-foreground">No pages yet.</p>
      )}
    </div>
  )

  let main
  if (mode === "new" && canEdit) {
    const parentId =
      parentParam && rows.some((r) => r.id === parentParam) ? parentParam : null
    main = (
      <WikiEditor
        key={`new-${parentId ?? "root"}`}
        groupId={group.id}
        parentId={parentId}
        position={rows.filter((r) => r.parentId === parentId).length}
        onSaved={(id) => select(id)}
        onCancel={() => void setMode(null)}
      />
    )
  } else if (tree.isPending || (pageId && page.isPending)) {
    main = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  } else if (!pageId) {
    main = (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpenIcon />
          </EmptyMedia>
          <EmptyTitle>No knowledge yet</EmptyTitle>
          <EmptyDescription>
            Keep the group's docs, how-tos and decisions in one place.
          </EmptyDescription>
        </EmptyHeader>
        {canEdit ? (
          <EmptyContent>
            <Button onClick={() => startNew(null)}>
              <PlusIcon /> Create the first page
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    )
  } else if (!page.data) {
    main = (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestionIcon />
          </EmptyMedia>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>
            It may have been deleted or moved.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => select(null)}>
            Back to Knowledge
          </Button>
        </EmptyContent>
      </Empty>
    )
  } else if (mode === "edit" && canEdit) {
    main = (
      <WikiEditor
        key={`edit-${page.data.id}`}
        groupId={group.id}
        page={page.data}
        onSaved={() => void setMode(null)}
        onCancel={() => void setMode(null)}
      />
    )
  } else {
    main = (
      <WikiPageView
        page={page.data}
        ancestors={ancestorsOf(rows, page.data.id)}
        canEdit={canEdit}
        canDelete={canDelete}
        onSelect={select}
        onEdit={() => void setMode("edit")}
        onDeleted={(parentId) => select(parentId)}
      />
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-[15rem_1fr]">
      {isMobile ? (
        <>
          <Button
            variant="outline"
            className="justify-start"
            onClick={() => setTreeOpen(true)}
          >
            <ListTreeIcon /> All pages
          </Button>
          <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
            <SheetContent side="left">
              <ScrollArea className="min-h-0 flex-1">
                <SheetHeader>
                  <SheetTitle>Knowledge</SheetTitle>
                  <SheetDescription className="sr-only">
                    Pages of this group
                  </SheetDescription>
                </SheetHeader>
                <div className="px-2 pb-4">{treePanel}</div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <aside className="self-start rounded-xl border bg-card p-2 md:sticky md:top-4">
          {treePanel}
        </aside>
      )}
      <section className="min-w-0 rounded-xl border bg-card p-4 md:p-6">
        {main}
      </section>
    </div>
  )
}
