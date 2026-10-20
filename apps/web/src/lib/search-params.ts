import { parseAsBoolean, parseAsString, parseAsStringLiteral } from "nuqs"

/** Where to send the user after signing in; only same-origin paths are honoured. */
export const redirectParser = parseAsString.withDefault("/")

export function safeRedirect(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/"
}

/** Chat sidebar quick filter. */
export const chatFilters = ["all", "unread", "muted"] as const
export type ChatFilter = (typeof chatFilters)[number]
export const chatFilterParser =
  parseAsStringLiteral(chatFilters).withDefault("all")

/** Chat details column (desktop) / sheet (mobile) and its active tab. */
export const chatInfoParser = parseAsBoolean.withDefault(true)
export const chatInfoTabs = ["info", "files", "members", "search"] as const
export type ChatInfoTab = (typeof chatInfoTabs)[number]
export const chatInfoTabParser =
  parseAsStringLiteral(chatInfoTabs).withDefault("info")
/** Search query inside the open conversation (the details "search" tab). */
export const chatSearchParser = parseAsString.withDefault("")

/** Channel settings dialog (open on a tab) in a group channel. */
export const channelSettingsParser = parseAsStringLiteral([
  "general",
  "integrations",
] as const)

/** Account settings tab. */
export const accountTabs = ["security", "notifications", "preferences"] as const
export type AccountTab = (typeof accountTabs)[number]
export const accountTabParser =
  parseAsStringLiteral(accountTabs).withDefault("security")
