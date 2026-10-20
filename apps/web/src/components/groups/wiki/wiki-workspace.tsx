import {
  BookOpenIcon,
  FileQuestionIcon,
  PanelLeftIcon,
  PlusIcon,
} from "lucide-react"
import { parseAsStringLiteral, useQueryState } from "nuqs"
import { useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { NewWikiPage, WikiEditor } from "./wiki-editor"
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
import { WikiSearchInput, WikiSearchResults } from "./wiki-search"
import { WikiTopBar } from "./wiki-top-bar"
import { WikiTree } from "./wiki-tree"

const MODES = ["edit", "new"] as const

/**
 * A group's Wiki as a docs workspace: page tree rail | doc pane. The open page is in the path
 * (`/groups/:slug/wiki/:pageId`); the mode, a new page's parent and the search are in the query
 * (`?wiki=edit|new`, `?parent=`, `?q=`).
 */
export function WikiWorkspace({
  group,
  pageParam,
}: {
  group: GroupWithMe
  pageParam: string | null
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const canEdit = useCanEditWiki(group)
  const [mode, setMode] = useQueryState("wiki", parseAsStringLiteral(MODES))
  const [parentParam, setParentParam] = useQueryState("parent")
  const [search, setSearch] = useQueryState("q")
  const [treeOpen, setTreeOpen] = useState(false)

  const tree = useDbQuery(wikiTreeKey(group.id), () => fetchWikiTree(group.id))
  const rows = tree.data ?? []
  // no page picked: open the first top-level page
  const pageId = pageParam ?? buildTree(rows)[0]?.id ?? null
  const page = useDbQuery(
    wikiPageKey(pageId ?? ""),
    () => fetchWikiPage(pageId ?? ""),
    {
      enabled: Boolean(pageId) && mode !== "new",
    }
  )
  const canDelete = useCanDeleteWikiPage(group, page.data?.createdBy.id)

  const base = `/groups/${group.slug}/wiki`
  const select = (id: string | null) => {
    void navigate(
      id
        ? `${base}/${id}${search ? `?q=${encodeURIComponent(search)}` : ""}`
        : base
    )
    setTreeOpen(false)
  }
  const startNew = (parentId: string | null) => {
    void setMode("new")
    void setParentParam(parentId)
    setTreeOpen(false)
  }

  const treeToggle = isMobile ? (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("wiki.workspace.allPages")}
      onClick={() => setTreeOpen(true)}
    >
      <PanelLeftIcon />
    </Button>
  ) : null

  const rail = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{t("groups.tabs.wiki")}</span>
        </h2>
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("wiki.workspace.newPage")}
            onClick={() => startNew(null)}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {rows.length ? (
            <WikiSearchInput value={search ?? ""} onChange={setSearch} />
          ) : null}
          {search ? (
            <WikiSearchResults
              groupId={group.id}
              query={search}
              onSelect={select}
            />
          ) : tree.isPending ? (
            <div className="flex flex-col gap-2 px-1">
              {Array.from({ length: 5 }, (_, i) => (
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
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {t("wiki.workspace.noPagesShort")}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )

  // editors and empty states share the pane chrome: top bar + scrolling column
  const pane = (title: string | undefined, body: ReactNode, wide = false) => (
    <div className="flex h-full min-h-0 flex-col">
      <WikiTopBar
        leading={treeToggle}
        groupName={group.name}
        ancestors={
          page.data && mode === "edit" ? ancestorsOf(rows, page.data.id) : []
        }
        title={title}
        onSelect={select}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div
          className={
            wide ? "mx-auto w-full max-w-4xl px-4 py-6 md:px-8" : "p-6"
          }
        >
          {body}
        </div>
      </ScrollArea>
    </div>
  )

  let main
  if (mode === "new" && canEdit) {
    const parentId =
      parentParam && rows.some((r) => r.id === parentParam) ? parentParam : null
    main = pane(
      t("wiki.workspace.newPage"),
      <NewWikiPage
        key={`new-${parentId ?? "root"}`}
        groupId={group.id}
        parentId={parentId}
        position={rows.filter((r) => r.parentId === parentId).length}
        onCreated={(id) => select(id)}
        onCancel={() => void setMode(null)}
      />,
      true
    )
  } else if (tree.isPending || (pageId && page.isPending)) {
    main = pane(
      undefined,
      <div className="mx-auto flex max-w-3xl flex-col gap-3 py-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-60 w-full" />
      </div>
    )
  } else if (!pageId) {
    main = pane(
      undefined,
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpenIcon />
          </EmptyMedia>
          <EmptyTitle>{t("wiki.workspace.noPages")}</EmptyTitle>
          <EmptyDescription>{t("wiki.workspace.noPagesBody")}</EmptyDescription>
        </EmptyHeader>
        {canEdit ? (
          <EmptyContent>
            <Button onClick={() => startNew(null)}>
              <PlusIcon /> {t("wiki.workspace.createFirst")}
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    )
  } else if (!page.data) {
    main = pane(
      undefined,
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestionIcon />
          </EmptyMedia>
          <EmptyTitle>{t("wiki.workspace.notFound")}</EmptyTitle>
          <EmptyDescription>
            {t("wiki.workspace.notFoundBody")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => select(null)}>
            {t("wiki.workspace.backToWiki")}
          </Button>
        </EmptyContent>
      </Empty>
    )
  } else if (mode === "edit" && canEdit) {
    main = pane(
      page.data.title,
      <WikiEditor
        key={`edit-${page.data.id}`}
        page={page.data}
        onDone={() => void setMode(null)}
      />,
      true
    )
  } else {
    main = (
      <WikiPageView
        page={page.data}
        groupName={group.name}
        leading={treeToggle}
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
    <div className="flex h-full min-h-0">
      {isMobile ? (
        <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
          <SheetContent
            side="left"
            className="p-0 [&>button:first-of-type]:hidden"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t("groups.tabs.wiki")}</SheetTitle>
              <SheetDescription>
                {t("wiki.workspace.pagesOfGroup")}
              </SheetDescription>
            </SheetHeader>
            {rail}
          </SheetContent>
        </Sheet>
      ) : (
        <aside className="w-64 shrink-0 border-r bg-muted/40">{rail}</aside>
      )}
      <section className="min-w-0 flex-1 bg-background">{main}</section>
    </div>
  )
}
