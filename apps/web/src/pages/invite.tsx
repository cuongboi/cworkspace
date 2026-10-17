import { Link, useParams } from "react-router-dom"
import { AuthCard } from "@/components/layout/auth-card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api, ApiError } from "@/lib/api-client"
import { authClient } from "@/lib/auth-client"
import { COMPANY_NAME } from "@/lib/company"
import { useDbQuery } from "@/lib/query"

type InvitationInfo = {
  email: string
  inviterName: string
  status: "PENDING" | "ACCEPTED" | "CANCELED"
  expired: boolean
}

/**
 * Landing page of an emailed invitation. Sign-up is open: the invitation is applied (role) by
 * the server when this email signs up, so the page only points to the right next step.
 */
export default function InvitePage() {
  const id = useParams().id ?? ""
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { data: invitation, error } = useDbQuery(
    ["invitation", "public", id],
    () => api.get<InvitationInfo>(`/api/invitations/${id}`),
    { enabled: Boolean(id), retry: false }
  )

  if (sessionPending || (!invitation && !error)) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  const unusable =
    !invitation || invitation.status !== "PENDING" || invitation.expired
  if (unusable && !session) {
    return (
      <AuthCard
        title="Invitation"
        description={
          error instanceof ApiError && error.code === "NOT_FOUND"
            ? "This invitation doesn't exist."
            : invitation?.status === "ACCEPTED"
              ? "This invitation was already used. Sign in to continue."
              : "This invitation is no longer valid. You can still create an account."
        }
      >
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link to="/sign-in">Sign in</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/sign-up">Create an account</Link>
          </Button>
        </div>
      </AuthCard>
    )
  }

  if (session) {
    return (
      <AuthCard
        title={`You're in ${COMPANY_NAME}`}
        description={`Signed in as ${session.user.email}`}
      >
        <Button asChild>
          <Link to="/">Go to the feed</Link>
        </Button>
      </AuthCard>
    )
  }

  // pending, valid, signed out
  const signUp = `/sign-up?email=${encodeURIComponent(invitation!.email)}&redirect=${encodeURIComponent("/")}`
  return (
    <AuthCard
      title={`Join ${COMPANY_NAME}`}
      description={`${invitation!.inviterName} invited ${invitation!.email}`}
    >
      <div className="flex flex-col gap-2">
        <Button asChild>
          <Link to={signUp}>Create your account</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/sign-in">I already have an account</Link>
        </Button>
      </div>
    </AuthCard>
  )
}
