/** The last group viewed, so /groups reopens it (per viewer, best effort). */
const KEY = "groups:last"

export function lastGroupSlug(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function rememberGroup(slug: string) {
  try {
    localStorage.setItem(KEY, slug)
  } catch {
    // storage unavailable: /groups falls back to the company group
  }
}
