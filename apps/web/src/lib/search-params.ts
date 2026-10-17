import { parseAsString } from "nuqs"

/** Where to send the user after signing in; only same-origin paths are honoured. */
export const redirectParser = parseAsString.withDefault("/")

export function safeRedirect(path: string) {
  return path.startsWith("/") && !path.startsWith("//") ? path : "/"
}
