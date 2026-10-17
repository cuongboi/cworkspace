import { useNavigate } from "react-router-dom"
import { useEffect } from "react"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"

/** Entry point: redirect to the active (or first) organization, or to onboarding. */
export default function Home() {
  const navigate = useNavigate()
  const { data: session, isPending } = authClient.useSession()
  const { data: orgs, isPending: orgsPending } =
    authClient.useListOrganizations()

  useEffect(() => {
    if (isPending) return
    if (!session) return void navigate("/sign-in", { replace: true })
    if (orgsPending) return
    const active =
      orgs?.find((o) => o.id === session.session.activeOrganizationId) ??
      orgs?.[0]
    void navigate(active ? `/${active.slug}` : "/onboarding", { replace: true })
  }, [isPending, session, orgs, orgsPending, navigate])

  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner className="size-6" />
    </div>
  )
}
