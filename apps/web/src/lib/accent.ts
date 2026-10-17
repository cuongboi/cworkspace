/**
 * Accent colors for initials avatars and group banners (design.html): a stable pick per
 * user/group id so the same person always gets the same color.
 */
export const ACCENTS = [
  "#2563eb", // blue-600
  "#16a34a", // green-600
  "#d97706", // amber-600
  "#9333ea", // purple-600
  "#ea580c", // orange-600
  "#0f766e", // teal-700
] as const

export function accentFor(key: string | null | undefined) {
  let hash = 0
  for (const ch of key ?? "") hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return ACCENTS[Math.abs(hash) % ACCENTS.length]!
}
