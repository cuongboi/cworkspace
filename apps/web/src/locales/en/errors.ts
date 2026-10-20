/** Fallback copy per `ApiError` code; see `errorMessage()` in `lib/i18n.ts`. */
export const errors = {
  UNAUTHORIZED: "Please sign in again.",
  FORBIDDEN: "You don't have permission to do that.",
  PASSWORD_CHANGE_REQUIRED: "Please change your password to continue.",
  INVALID_INPUT: "Please check what you entered.",
  NOT_FOUND: "It no longer exists.",
  CONFLICT: "That already exists.",
  INVALID_STATE: "That can't be done right now.",
  UPSTREAM_ERROR: "A connected service isn't responding. Try again later.",
  INTERNAL: "Something went wrong. Try again.",
  NETWORK: "Can't reach the server. Check your connection.",
}
