import { parseAsString, parseAsStringLiteral } from "nuqs"

/** Where to send the user after signing in; only same-origin paths are honoured. */
export const redirectParser = parseAsString.withDefault("/")

export function safeRedirect(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/"
}

/** Chat list filter pill (Teams-style). */
export const chatFilters = ["all", "unread", "direct", "group"] as const
export type ChatFilter = (typeof chatFilters)[number]
export const chatFilterParser =
  parseAsStringLiteral(chatFilters).withDefault("all")
