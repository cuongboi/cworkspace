import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
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
        title={t("auth.invite.title")}
        description={
          error instanceof ApiError && error.code === "NOT_FOUND"
            ? t("auth.invite.notFound")
            : invitation?.status === "ACCEPTED"
              ? t("auth.invite.used")
              : t("auth.invite.invalid")
        }
      >
        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link to="/sign-in">{t("auth.invite.signIn")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/sign-up">{t("auth.invite.createAccount")}</Link>
          </Button>
        </div>
      </AuthCard>
    )
  }

  if (session) {
    return (
      <AuthCard
        title={t("auth.invite.youreIn", { company: COMPANY_NAME })}
        description={t("auth.invite.signedInAs", { email: session.user.email })}
      >
        <Button asChild>
          <Link to="/">{t("auth.invite.goToFeed")}</Link>
        </Button>
      </AuthCard>
    )
  }

  // pending, valid, signed out
  const signUp = `/sign-up?email=${encodeURIComponent(invitation!.email)}&redirect=${encodeURIComponent("/")}`
  return (
    <AuthCard
      title={t("auth.invite.join", { company: COMPANY_NAME })}
      description={t("auth.invite.invited", {
        inviter: invitation!.inviterName,
        email: invitation!.email,
      })}
    >
      <div className="flex flex-col gap-2">
        <Button asChild>
          <Link to={signUp}>{t("auth.invite.createYourAccount")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/sign-in">{t("auth.invite.haveAccount")}</Link>
        </Button>
      </div>
    </AuthCard>
  )
}
