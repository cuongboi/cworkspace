import { createAuthClient } from "better-auth/react"
import {
  adminClient,
  jwtClient,
  organizationClient,
} from "better-auth/client/plugins"

export const authClient = createAuthClient({
  basePath: "/api/auth",
  fetchOptions: { credentials: "include" },
  plugins: [jwtClient(), adminClient(), organizationClient()],
})

export type AuthSession = NonNullable<(typeof authClient.$Infer)["Session"]>
export type SessionUser = AuthSession["user"]
