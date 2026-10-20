import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragMoveEvent,
} from "@dnd-kit/core"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderInputIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { invalidateModels } from "@/lib/query"
import {
  buildTree,
  subtreeIds,
  type WikiNode,
  type WikiTreeRow,
} from "./wiki-query"

type TreeProps = {
  groupId: string
  rows: WikiTreeRow[]
  activeId: string | null
  canEdit: boolean
  onSelect: (id: string) => void
  onNewChild: (parentId: string) => void
}

type DropZone = "before" | "inside" | "after"
type DropTarget = { id: string; zone: DropZone } | null

/** Which part of the row the dragged row's center is over: top/bottom quarter = sibling. */
function zoneOf(e: DragMoveEvent): DropTarget {
  const over = e.over
  const rect = e.active.rect.current.translated
  if (!over || !rect || over.id === e.active.id) return null
  const y = rect.top + rect.height / 2
  const ratio = (y - over.rect.top) / over.rect.height
  const zone = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside"
  return { id: String(over.id), zone }
}

/**
 * Nested page list. Pages with children can be collapsed; the active page's ancestors stay open.
 * Editors drag a page onto another (inside it) or onto its top/bottom edge (beside it).
 */
export function WikiTree(props: TreeProps) {
  const { t } = useTranslation()
  const [moving, setMoving] = useState<WikiTreeRow | null>(null)
  const [drop, setDrop] = useState<DropTarget>(null)
  const move = useMovePage(props.groupId)
  // a small distance threshold keeps plain clicks working
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  const roots = buildTree(props.rows)

  const onDrop = (pageId: string, target: DropTarget) => {
    if (!target) return
    const { rows } = props
    if (subtreeIds(rows, pageId).has(target.id)) return
    const over = rows.find((r) => r.id === target.id)
    if (!over) return
    if (target.zone === "inside") {
      const count = rows.filter(
        (r) => r.parentId === over.id && r.id !== pageId
      ).length
      return void move(pageId, over.id, count)
    }
    // the server re-numbers siblings without the moved page, so index among the others
    const siblings = rows
      .filter((r) => r.parentId === over.parentId && r.id !== pageId)
      .sort((a, b) => a.position - b.position)
    const index = siblings.findIndex((r) => r.id === over.id)
    void move(
      pageId,
      over.parentId,
      target.zone === "before" ? index : index + 1
    )
  }

  return (
    <DndContext
      sensors={sensors}
      onDragMove={(e) => setDrop(zoneOf(e))}
      onDragEnd={(e) => {
        onDrop(String(e.active.id), zoneOf(e))
        setDrop(null)
      }}
      onDragCancel={() => setDrop(null)}
    >
      <ul
        className="flex flex-col"
        role="tree"
        aria-label={t("wiki.tree.pages")}
      >
        {roots.map((node, i) => (
          <TreeItem
            key={node.id}
            node={node}
            depth={0}
            index={i}
            siblings={roots.length}
            onMove={setMoving}
            drop={drop}
            {...props}
          />
        ))}
      </ul>
      {moving ? (
        <MoveDialog
          key={moving.id}
          groupId={props.groupId}
          rows={props.rows}
          page={moving}
          onClose={() => setMoving(null)}
        />
      ) : null}
    </DndContext>
  )
}

function useMovePage(groupId: string) {
  const qc = useQueryClient()
  return async (pageId: string, parentId: string | null, position: number) => {
    try {
      await api.post(`/api/groups/${groupId}/wiki/${pageId}/move`, {
        parentId,
        position,
      })
      await invalidateModels(qc, ["wikiPage"])
      return true
    } catch (err) {
      toast.error(errorMessage(err))
      return false
    }
  }
}

function containsActive(node: WikiNode, activeId: string | null): boolean {
  return node.children.some(
    (c) => c.id === activeId || containsActive(c, activeId)
  )
}

function TreeItem({
  node,
  depth,
  index,
  siblings,
  onMove,
  drop,
  ...props
}: TreeProps & {
  node: WikiNode
  depth: number
  index: number
  siblings: number
  onMove: (row: WikiTreeRow) => void
  drop: DropTarget
}) {
  const { t } = useTranslation()
  const { groupId, activeId, canEdit, onSelect, onNewChild } = props
  const [collapsed, setCollapsed] = useState(false)
  const move = useMovePage(groupId)
  const hasChildren = node.children.length > 0
  // keep the path to the open page visible even if a parent was collapsed
  const open = hasChildren && (!collapsed || containsActive(node, activeId))
  const active = node.id === activeId
  const drag = useDraggable({ id: node.id, disabled: !canEdit })
  const dropRef = useDroppable({ id: node.id, disabled: !canEdit }).setNodeRef
  const zone = drop?.id === node.id ? drop.zone : null

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? open : undefined}
      aria-selected={active}
    >
      <div
        ref={(el) => {
          drag.setNodeRef(el)
          dropRef(el)
        }}
        {...drag.attributes}
        {...drag.listeners}
        // the row's own buttons stay the keyboard path (dnd-kit's role/tabIndex would hijack it)
        role={undefined}
        tabIndex={undefined}
        className={cn(
          "group/item relative flex items-center gap-0.5 rounded-md pr-1 text-sm hover:bg-accent",
          active && "bg-accent font-medium",
          drag.isDragging && "opacity-40",
          zone === "inside" && "ring-2 ring-primary ring-inset",
          zone === "before" &&
            "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-primary",
          zone === "after" &&
            "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary"
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          aria-label={open ? t("wiki.tree.collapse") : t("wiki.tree.expand")}
          onClick={() => setCollapsed(open)}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground",
            !hasChildren && "invisible"
          )}
        >
          <ChevronRightIcon
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
          />
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left outline-none focus-visible:underline"
        >
          <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.title}</span>
        </button>
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("wiki.tree.actionsFor", { title: node.title })}
                className="opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => onNewChild(node.id)}>
                <PlusIcon /> {t("wiki.tree.newSubpage")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={index === 0}
                onSelect={() => void move(node.id, node.parentId, index - 1)}
              >
                <ArrowUpIcon /> {t("wiki.tree.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === siblings - 1}
                onSelect={() => void move(node.id, node.parentId, index + 1)}
              >
                <ArrowDownIcon /> {t("wiki.tree.moveDown")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove(node)}>
                <FolderInputIcon /> {t("wiki.tree.moveTo")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {open ? (
        <ul role="group">
          {node.children.map((child, i) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              index={i}
              siblings={node.children.length}
              onMove={onMove}
              drop={drop}
              {...props}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** Pick a new parent (top level, or any page outside the moved page's own subtree). */
function MoveDialog({
  groupId,
  rows,
  page,
  onClose,
}: {
  groupId: string
  rows: WikiTreeRow[]
  page: WikiTreeRow
  onClose: () => void
}) {
  const { t } = useTranslation()
  const move = useMovePage(groupId)
  const [parentId, setParentId] = useState(page.parentId ?? "")
  const [busy, setBusy] = useState(false)
  const excluded = subtreeIds(rows, page.id)

  // depth-first order with indentation, like the tree
  const options: { id: string; label: string }[] = []
  const walk = (nodes: WikiNode[], depth: number) => {
    for (const n of nodes) {
      if (excluded.has(n.id)) continue
      options.push({ id: n.id, label: `${"  ".repeat(depth)}${n.title}` })
      walk(n.children, depth + 1)
    }
  }
  walk(buildTree(rows), 0)

  const submit = async () => {
    const target = parentId || null
    const position = rows.filter(
      (r) => r.parentId === target && r.id !== page.id
    ).length
    setBusy(true)
    const ok = await move(page.id, target, position)
    setBusy(false)
    if (ok) {
      toast.success(t("wiki.tree.moved"))
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("wiki.tree.moveTitle", { title: page.title })}
          </DialogTitle>
          <DialogDescription>{t("wiki.tree.moveBody")}</DialogDescription>
        </DialogHeader>
        <NativeSelect
          aria-label={t("wiki.tree.newParent")}
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="w-full"
        >
          <NativeSelectOption value="">
            {t("wiki.tree.topLevel")}
          </NativeSelectOption>
          {options.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || parentId === (page.parentId ?? "")}
          >
            {busy ? <Spinner /> : null}
            {t("wiki.tree.move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
