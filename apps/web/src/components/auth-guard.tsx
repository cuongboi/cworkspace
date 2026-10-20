import { useTranslation } from "react-i18next"
import { Navigate, Outlet, useLocation } from "react-router-dom"

import { authClient } from "@/lib/auth-client"

function FullPageSpinner() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      {t("common.loading")}
    </div>
  )
}

/** Renders child routes only for signed-in users; otherwise sends them to sign-in. */
export function RequireAuth() {
  const { data: session, isPending } = authClient.useSession()
  const location = useLocation()

  if (isPending) return <FullPageSpinner />
  if (!session) {
    const redirect = location.pathname + location.search
    const query =
      redirect === "/" ? "" : `?redirect=${encodeURIComponent(redirect)}`
    return <Navigate to={`/sign-in${query}`} replace />
  }
  return <Outlet />
}

/** Renders child routes only for signed-out users (sign-in, sign-up, …). */
export function GuestOnly() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return <FullPageSpinner />
  if (session) return <Navigate to="/" replace />
  return <Outlet />
}
