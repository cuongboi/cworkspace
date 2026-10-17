import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import type { GroupWithMe } from "../group-query"

/**
 * Knowledge (group wiki) queries and helpers. Keys start with the model name so `wiki:changed`
 * invalidations (see `useRealtimeSync`) reach them.
 */

const PAGE = 100
const MAX_TREE_PAGES = 10

export const wikiTreeKey = (groupId: string) =>
  ["wikiPage", "tree", groupId] as const

/** Every page of the group as a flat list (the API caps a page at 100 rows: walk the cursor). */
export async function fetchWikiTree(groupId: string) {
  const all: WikiTreeRow[] = []
  for (let page = 0; page < MAX_TREE_PAGES; page++) {
    const cursor = all.at(-1)?.id
    const rows = await db.wikiPage.findMany({
      where: { groupId },
      select: { id: true, parentId: true, title: true, position: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

export type WikiTreeRow = {
  id: string
  parentId: string | null
  title: string
  position: number
}

export type WikiNode = WikiTreeRow & { children: WikiNode[] }

/** Nests the flat rows; orphans (parent not visible) become roots so nothing gets lost. */
export function buildTree(rows: WikiTreeRow[]): WikiNode[] {
  const nodes = new Map(
    rows.map((r) => [r.id, { ...r, children: [] as WikiNode[] }])
  )
  const roots: WikiNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (list: WikiNode[]) => {
    list.sort((a, b) => a.position - b.position)
    for (const n of list) sort(n.children)
  }
  sort(roots)
  return roots
}

/** Root → page chain, for breadcrumbs. */
export function ancestorsOf(rows: WikiTreeRow[], id: string) {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const chain: WikiTreeRow[] = []
  let cursor = byId.get(id)?.parentId ?? null
  while (cursor && chain.length < 50) {
    const row = byId.get(cursor)
    if (!row) break
    chain.unshift(row)
    cursor = row.parentId
  }
  return chain
}

/** `id` and every page below it (a page can't be moved into its own subtree). */
export function subtreeIds(rows: WikiTreeRow[], id: string) {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const r of rows) {
      if (r.parentId && ids.has(r.parentId) && !ids.has(r.id)) {
        ids.add(r.id)
        grew = true
      }
    }
  }
  return ids
}

const author = { select: { id: true, name: true, image: true } } as const

export const wikiPageKey = (id: string) =>
  ["wikiPage", "findUnique", id] as const

export function fetchWikiPage(id: string) {
  return db.wikiPage.findUnique({
    where: { id },
    select: {
      id: true,
      groupId: true,
      parentId: true,
      title: true,
      content: true,
      version: true,
      createdAt: true,
      updatedAt: true,
      createdBy: author,
      revisions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true, author },
      },
      _count: { select: { children: true } },
    },
  })
}

export type WikiPageDetail = NonNullable<
  Awaited<ReturnType<typeof fetchWikiPage>>
>

export const wikiRevisionsKey = (pageId: string) =>
  ["wikiRevision", "page", pageId] as const

export function fetchWikiRevisions(pageId: string) {
  return db.wikiRevision.findMany({
    where: { pageId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, title: true, content: true, createdAt: true, author },
  })
}

export type WikiRevisionRow = Awaited<
  ReturnType<typeof fetchWikiRevisions>
>[number]

/** Mirrors the WikiPage create/update policy (the server enforces it; this only hides buttons). */
export function useCanEditWiki(group: GroupWithMe) {
  const { isAdmin } = useApp()
  const m = group.members[0]
  if (isAdmin) return true
  if (m?.status !== "ACTIVE") return false
  return (
    group.wikiEditPolicy === "MEMBERS" ||
    m.role === "ADMIN" ||
    m.role === "MODERATOR"
  )
}

/** Mirrors the WikiPage delete policy. */
export function useCanDeleteWikiPage(
  group: GroupWithMe,
  createdById: string | undefined
) {
  const { isAdmin, me } = useApp()
  const m = group.members[0]
  if (isAdmin) return true
  if (m?.status !== "ACTIVE") return false
  if (m.role === "ADMIN" || m.role === "MODERATOR") return true
  return group.wikiEditPolicy === "MEMBERS" && createdById === me.id
}
