import type { SocialProvider } from "@app/shared/app-config"
import { useQueryState } from "nuqs"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { APP_CONFIG } from "@/lib/company"
import { redirectParser, safeRedirect } from "@/lib/search-params"

const NAMES: Record<SocialProvider, string> = {
  google: "Google",
  github: "GitHub",
  line: "LINE",
}

/**
 * Sign-in buttons for the providers an admin enabled (Settings → Sign-in). A new account made
 * this way joins the company like an email sign-up (first admin, All company, invitations).
 */
export function SocialSignIn() {
  const { t } = useTranslation()
  const [redirect] = useQueryState("redirect", redirectParser)
  const [pending, setPending] = useState<SocialProvider | null>(null)
  const [error, setError] = useState<string | null>(null)
  const providers = APP_CONFIG.socialProviders
  if (!providers.length) return null

  const start = async (provider: SocialProvider) => {
    setPending(provider)
    setError(null)
    const origin = window.location.origin
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: `${origin}${safeRedirect(redirect)}`,
      errorCallbackURL: `${origin}/sign-in`,
    })
    // on success the browser is already leaving for the provider
    if (error) {
      setPending(null)
      setError(t("auth.social.failed", { provider: NAMES[provider] }))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {providers.map((p) => (
        <Button
          key={p}
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending !== null}
          onClick={() => void start(p)}
        >
          {pending === p ? <Spinner /> : null}
          {t("auth.social.continueWith", { provider: NAMES[p] })}
        </Button>
      ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="my-2 flex items-center gap-3 text-xs text-muted-foreground uppercase">
        <span className="h-px flex-1 bg-border" />
        {t("auth.social.or")}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
