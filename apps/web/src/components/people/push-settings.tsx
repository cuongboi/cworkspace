import { BellIcon, ShareIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api-client"
import {
  type PushSupport,
  disablePush,
  enablePush,
  isPushEnabledHere,
  pushConfig,
  pushSupport,
} from "@/lib/push"

type State = PushSupport | "loading" | "not-configured"

/** Per-device push opt-in, shown on your own profile. */
export function PushSettings() {
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
          toast.success("Push notifications enabled on this device")
        } else {
          toast.error("Notifications were not allowed")
        }
      } else {
        await disablePush()
        setEnabled(false)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update push")
    } finally {
      setBusy(false)
    }
  }

  const sendTest = () =>
    api
      .post("/api/push/test")
      .then(() => toast.success("Test sent. Lock your device or switch apps."))
      .catch((err: Error) => toast.error(err.message))

  if (state === "loading" || state === "not-configured") return null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <BellIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium">
              Push notifications on this device
            </p>
            <p className="text-xs text-muted-foreground">
              Messages, calls, mentions and reminders, even when the app is
              closed.
            </p>
          </div>
          {state === "supported" ? (
            <Switch
              checked={enabled}
              disabled={busy || denied}
              onCheckedChange={toggle}
              aria-label="Push notifications on this device"
            />
          ) : null}
        </div>
        {state === "ios-needs-install" ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            On iPhone or iPad, tap <ShareIcon className="inline size-3.5" />{" "}
            Share → <strong>Add to Home Screen</strong>, then open the app from
            your Home Screen to turn on notifications.
          </p>
        ) : null}
        {state === "unsupported" ? (
          <p className="text-xs text-muted-foreground">
            This browser does not support push notifications.
          </p>
        ) : null}
        {state === "supported" && denied ? (
          <p className="text-xs text-muted-foreground">
            Notifications are blocked. Allow them for this site in your browser
            or system settings, then reload.
          </p>
        ) : null}
        {state === "supported" && enabled ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={sendTest}
          >
            Send test notification
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
