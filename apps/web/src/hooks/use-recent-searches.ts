import { useCallback, useState } from "react"

export type RecentSearchKind = "user" | "group" | "post" | "message" | "file"

export type RecentSearch = {
  kind: RecentSearchKind
  id: string
  label: string
  subtitle?: string
  href: string
  /** image for people avatars */
  image?: string | null
  /** ISO creation time of posts, messages and files */
  date?: string
  at: number
}

const KEY = "cworkplace:recent-search"
const MAX = 15

function load(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as RecentSearch[]) : []
  } catch {
    return []
  }
}

/** Per-browser history of picked search results (a convenience, so localStorage is enough). */
export function useRecentSearches() {
  const [items, setItems] = useState(load)

  const add = useCallback((item: Omit<RecentSearch, "at">) => {
    setItems((prev) => {
      const next = [
        { ...item, at: Date.now() },
        ...prev.filter((r) => !(r.kind === item.kind && r.id === item.id)),
      ].slice(0, MAX)
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // storage blocked: keep the in-memory list
      }
      return next
    })
  }, [])

  return { items, add }
}
