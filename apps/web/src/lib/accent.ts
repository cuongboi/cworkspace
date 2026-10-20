/**
 * Accent colors for initials avatars and group banners: a stable pick per user/group id
 * so the same person always gets the same color. Values live in index.css (`--accent-1..6`)
 * so they adapt to dark mode.
 */
export const ACCENTS = [
  "var(--accent-1)",
  "var(--accent-2)",
  "var(--accent-3)",
  "var(--accent-4)",
  "var(--accent-5)",
  "var(--accent-6)",
] as const

export function accentFor(key: string | null | undefined) {
  let hash = 0
  for (const ch of key ?? "") hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return ACCENTS[Math.abs(hash) % ACCENTS.length]!
}
