import {
  extractLinks,
  type LinkPreview,
  matchEmbed,
  mediaTypeFromUrl,
} from "@app/shared/link-preview"
import { useQuery } from "@tanstack/react-query"
import { api, type ApiError } from "@/lib/api-client"

export { extractLinks, type LinkPreview }

/**
 * What to render for a URL. Media extensions and known video providers resolve locally (instant,
 * no request); everything else asks the server, which fetches the page's Open Graph tags.
 */
export function useLinkPreview(url: string) {
  const local = localPreview(url)
  const query = useQuery<LinkPreview, ApiError>({
    // not a model name: realtime invalidation never touches it
    queryKey: ["linkPreview", url],
    queryFn: () =>
      api.get<LinkPreview>(`/api/link-preview?url=${encodeURIComponent(url)}`),
    enabled: local === null,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: false,
  })
  return {
    preview: local ?? query.data ?? null,
    loading: local === null && query.isPending,
  }
}

function localPreview(url: string): LinkPreview | null {
  const media = mediaTypeFromUrl(url)
  return media ? { type: media, url } : matchEmbed(url)
}

/** True when the whole text is one media URL: the media alone says it all. */
export function isBareMediaUrl(text: string) {
  const t = text.trim()
  return (
    /^\S+$/.test(t) &&
    extractLinks(t, 1)[0] === t &&
    mediaTypeFromUrl(t) !== null
  )
}

/** "github.com/org/repo/…" for display; the href keeps the full URL. */
export function shortUrl(raw: string, max = 60) {
  try {
    const u = new URL(raw)
    const s = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}${u.search}`
    return s.length > max ? `${s.slice(0, max - 1)}…` : s
  } catch {
    return raw
  }
}
