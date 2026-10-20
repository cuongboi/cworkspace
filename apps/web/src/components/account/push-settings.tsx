import { BellIcon, ShareIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import {
  type PushSupport,
  disablePush,
  enablePush,
  isPushEnabledHere,
  pushConfig,
  pushSupport,
} from "@/lib/push"

type State = PushSupport | "loading" | "not-configured"

/** Per-device push opt-in (account settings → Notifications). */
export function PushSettings() {
  const { t } = useTranslation()
  const [state, setState] = useState<State>("loading")
  const [enabled, setEnabled] = useState(isPushEnabledHere)
  const [busy, setBusy] = useState(false)
  const denied =
    "Notification" in window && Notification.permission === "denied"

  useEffect(() => {
    let cancelled = false
    Promise.all([pushConfig(), pushSupport()])
      .then(([config, support]) => {
        if (!cancelled) setState(config.enabled ? support : "not-configured")
      })
      .catch(() => !cancelled && setState("unsupported"))
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      if (on) {
        const permission = await enablePush()
        if (permission === "granted") {
          setEnabled(true)
          toast.success(t("people.push.enabled"))
        } else {
          toast.error(t("people.push.notAllowed"))
        }
      } else {
        await disablePush()
        setEnabled(false)
      }
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t("people.push.updateFailed")
      )
    } finally {
      setBusy(false)
    }
  }

  const sendTest = () =>
    api
      .post("/api/push/test")
      .then(() => toast.success(t("people.push.testSent")))
      .catch((err: unknown) => toast.error(errorMessage(err)))

  if (state === "loading") return null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <BellIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium">{t("people.push.title")}</p>
            <p className="text-xs text-muted-foreground">
              {t("people.push.description")}
            </p>
          </div>
          {state === "supported" ? (
            <Switch
              checked={enabled}
              disabled={busy || denied}
              onCheckedChange={toggle}
              aria-label={t("people.push.title")}
            />
          ) : null}
        </div>
        {state === "ios-needs-install" ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Trans
              i18nKey="people.push.iosInstall"
              components={{
                icon: <ShareIcon className="inline size-3.5" />,
                b: <strong />,
              }}
            />
          </p>
        ) : null}
        {state === "not-configured" ? (
          <p className="text-xs text-muted-foreground">
            {t("people.push.notConfigured")}
          </p>
        ) : null}
        {state === "unsupported" ? (
          <p className="text-xs text-muted-foreground">
            {t("people.push.unsupported")}
          </p>
        ) : null}
        {state === "supported" && denied ? (
          <p className="text-xs text-muted-foreground">
            {t("people.push.blocked")}
          </p>
        ) : null}
        {state === "supported" && enabled ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={sendTest}
          >
            {t("people.push.sendTest")}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
