import i18n from "@/lib/i18n"

/** better-auth client calls resolve to `{ data, error }`: turn errors into exceptions. */
export async function unwrap<T>(
  promise: Promise<{
    data: T | null
    error: { message?: string; statusText?: string } | null
  }>
): Promise<T> {
  const { data, error } = await promise
  if (error)
    throw new Error(
      error.message || error.statusText || i18n.t("settings.requestFailed")
    )
  return data as T
}

/** better-auth errors carry a readable server message; fall back to the localized copy. */
export const errorMessage = (err: unknown, fallback?: string) =>
  err instanceof Error && err.message
    ? err.message
    : (fallback ?? i18n.t("errors.INTERNAL"))

/** Instance role (better-auth admin plugin `User.role`). */
export type InstanceRole = "user" | "admin"

export const roleLabel = (role: InstanceRole) =>
  i18n.t(`settings.roles.${role}`)

export const roleDescription = (role: InstanceRole) =>
  i18n.t(`settings.roleDescriptions.${role}`)

export function asRole(role: string | null | undefined): InstanceRole {
  return role === "admin" ? "admin" : "user"
}
