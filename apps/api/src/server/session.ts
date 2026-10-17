import { authDb } from "../lib/db";

/** The signed-in user as seen by route handlers and socket handlers. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string | null;
};

export function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  role?: string | null;
}): SessionUser {
  const { id, email, name } = user;
  return { id, email, name, image: user.image ?? null, role: user.role ?? null };
}

/** Policy-enforcing client scoped to `user`. The only client to use on behalf of a user. */
export function dbFor(user: Pick<SessionUser, "id" | "email" | "role">) {
  return authDb.$setAuth({ id: user.id, email: user.email, role: user.role });
}
