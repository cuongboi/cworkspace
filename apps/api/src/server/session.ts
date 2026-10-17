import { authDb } from "../lib/db";

/** The signed-in user as seen by route handlers and socket handlers. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string | null;
  permissions: Permission[];
};

/** One RBAC grant from `User.permissions`, bound to `auth().permissions` in policies. */
export type Permission = { model: string; actions: string[] };

export function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  role?: string | null;
  permissions?: unknown;
}): SessionUser {
  const { id, email, name } = user;
  return {
    id,
    email,
    name,
    image: user.image ?? null,
    role: user.role ?? null,
    permissions: Array.isArray(user.permissions) ? (user.permissions as Permission[]) : [],
  };
}

/** Policy-enforcing client scoped to `user`. The only client to use on behalf of a user. */
export function dbFor(user: Pick<SessionUser, "id" | "email" | "role" | "permissions">) {
  const { id, email, role, permissions } = user;
  return authDb.$setAuth({ id, email, role, permissions });
}
