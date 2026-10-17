import type { OrgRole } from "@/hooks/use-org"

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

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
}

export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: "Full control, including deleting the organization",
  admin: "Manages members, invitations and settings",
  member: "Uses groups, chat and the calendar",
}

export function asRole(role: string | null | undefined): OrgRole {
  return role === "owner" || role === "admin" ? role : "member"
}
