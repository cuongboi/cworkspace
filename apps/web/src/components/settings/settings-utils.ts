/** better-auth client calls resolve to `{ data, error }`: turn errors into exceptions. */
export async function unwrap<T>(
  promise: Promise<{
    data: T | null
    error: { message?: string; statusText?: string } | null
  }>
): Promise<T> {
  const { data, error } = await promise
  if (error)
    throw new Error(error.message || error.statusText || "Request failed")
  return data as T
}

export const errorMessage = (
  err: unknown,
  fallback = "Something went wrong"
) => (err instanceof Error && err.message ? err.message : fallback)

/** Instance role (better-auth admin plugin `User.role`). */
export type InstanceRole = "user" | "admin"

export const ROLE_LABELS: Record<InstanceRole, string> = {
  admin: "Admin",
  user: "Member",
}

export const ROLE_DESCRIPTIONS: Record<InstanceRole, string> = {
  admin: "Manages people, invitations and every group",
  user: "Uses groups, chat and the calendar",
}

export function asRole(role: string | null | undefined): InstanceRole {
  return role === "admin" ? "admin" : "user"
}
