import { Link, useNavigate, useParams } from "react-router-dom"
import { useEffect, useState } from "react"
import { AuthCard } from "@/components/layout/auth-card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"

type Invitation = {
  organizationName: string
  inviterEmail: string
  email: string
  status: string
}

export default function InvitePage() {
  const params = useParams()
  const navigate = useNavigate()
  const id = params.id
  const { data: session, isPending } = authClient.useSession()
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // keyed on the user, not the session object: accepting changes the active org (a new session
  // object) and the accepted invitation must not be fetched again
  const userId = session?.user.id
  useEffect(() => {
    if (!id || !userId) return
    authClient.organization
      .getInvitation({ query: { id } })
      .then(({ data, error }) => {
        if (error || !data)
          setError(
            error?.message ?? "This invitation is invalid or has expired"
          )
        else setInvitation(data as Invitation)
      })
  }, [id, userId])

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  const here = `/invite/${id}`
  if (!session) {
    return (
      <AuthCard
        title="You're invited"
        description="Sign in or create an account to accept the invitation."
      >
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link to={`/sign-up?redirect=${encodeURIComponent(here)}`}>
              Create an account
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to={`/sign-in?redirect=${encodeURIComponent(here)}`}>
              Sign in
            </Link>
          </Button>
        </div>
      </AuthCard>
    )
  }

  async function respond(accept: boolean) {
    if (!id) return
    setBusy(true)
    if (accept) {
      const { data, error } = await authClient.organization.acceptInvitation({
        invitationId: id,
      })
      if (error || !data) {
        setBusy(false)
        return setError(error?.message ?? "Could not accept the invitation")
      }
      const orgId = data.member.organizationId
      await authClient.organization.setActive({ organizationId: orgId })
      const { data: orgs } = await authClient.organization.list()
      const org = orgs?.find((o) => o.id === orgId)
      await navigate(org ? `/${org.slug}` : "/", { replace: true })
    } else {
      await authClient.organization.rejectInvitation({ invitationId: id })
      await navigate("/", { replace: true })
    }
  }

  return (
    <AuthCard
      title={invitation ? `Join ${invitation.organizationName}` : "Invitation"}
      description={
        invitation
          ? `${invitation.inviterEmail} invited ${invitation.email}`
          : undefined
      }
      footer={`Signed in as ${session.user.email}`}
    >
      {error ? (
        <div className="flex flex-col gap-3 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" asChild>
            <Link to="/">Go home</Link>
          </Button>
        </div>
      ) : !invitation ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => respond(false)}
          >
            Decline
          </Button>
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => respond(true)}
          >
            {busy ? <Spinner /> : null}
            Accept
          </Button>
        </div>
      )}
    </AuthCard>
  )
}
