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
import { ApiError, api } from "@/lib/api-client"
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

/** Nested page list. Pages with children can be collapsed; the active page's ancestors stay open. */
export function WikiTree(props: TreeProps) {
  const [moving, setMoving] = useState<WikiTreeRow | null>(null)
  const roots = buildTree(props.rows)
  return (
    <>
      <ul className="flex flex-col" role="tree" aria-label="Pages">
        {roots.map((node, i) => (
          <TreeItem
            key={node.id}
            node={node}
            depth={0}
            index={i}
            siblings={roots.length}
            onMove={setMoving}
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
    </>
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
      toast.error(
        err instanceof ApiError ? err.message : "Could not move the page"
      )
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
  ...props
}: TreeProps & {
  node: WikiNode
  depth: number
  index: number
  siblings: number
  onMove: (row: WikiTreeRow) => void
}) {
  const { groupId, activeId, canEdit, onSelect, onNewChild } = props
  const [collapsed, setCollapsed] = useState(false)
  const move = useMovePage(groupId)
  const hasChildren = node.children.length > 0
  // keep the path to the open page visible even if a parent was collapsed
  const open = hasChildren && (!collapsed || containsActive(node, activeId))
  const active = node.id === activeId

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? open : undefined}
      aria-selected={active}
    >
      <div
        className={cn(
          "group/item flex items-center gap-0.5 rounded-md pr-1 text-sm hover:bg-accent",
          active && "bg-accent font-medium"
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          aria-label={open ? "Collapse" : "Expand"}
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
                aria-label={`Actions for ${node.title}`}
                className="opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => onNewChild(node.id)}>
                <PlusIcon /> New subpage
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={index === 0}
                onSelect={() => void move(node.id, node.parentId, index - 1)}
              >
                <ArrowUpIcon /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === siblings - 1}
                onSelect={() => void move(node.id, node.parentId, index + 1)}
              >
                <ArrowDownIcon /> Move down
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove(node)}>
                <FolderInputIcon /> Move to…
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
      toast.success("Page moved")
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move “{page.title}”</DialogTitle>
          <DialogDescription>
            Its subpages move with it. It is added at the end of the new
            location.
          </DialogDescription>
        </DialogHeader>
        <NativeSelect
          aria-label="New parent page"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="w-full"
        >
          <NativeSelectOption value="">Top level</NativeSelectOption>
          {options.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>
              {o.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || parentId === (page.parentId ?? "")}
          >
            {busy ? <Spinner /> : null}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
