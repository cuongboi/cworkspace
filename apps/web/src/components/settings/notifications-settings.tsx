import { useMutation } from "@tanstack/react-query"
import { MailIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { type ApiError, api } from "@/lib/api-client"
import {
  type AdminSettings,
  type PushConfig,
  SettingsCard,
  SettingsSkeleton,
  useAdminSettings,
  useDraft,
  useSaveSettings,
} from "./app-settings-form"

type EmailDraft = AdminSettings["email"] & { resendApiKey?: string | null }
type PushDraft = PushConfig & { firebasePrivateKey?: string | null }

/** Settings → Notifications: email (Resend) and push (Firebase Cloud Messaging). */
export function NotificationsSettings() {
  const { data } = useAdminSettings()
  if (!data) return <SettingsSkeleton />
  return (
    <div className="flex flex-col gap-6">
      <EmailCard data={data} />
      <PushCard data={data} />
    </div>
  )
}

/** A secret field: shows the saved key's hint, replaces it when typed, clears on request. */
function SecretInput({
  id,
  value,
  hint,
  multiline,
  onChange,
}: {
  id: string
  value: string | null | undefined
  hint: string | null
  multiline?: boolean
  onChange: (value: string | null) => void
}) {
  const { t } = useTranslation()
  const shown = value ?? ""
  return (
    <>
      {multiline ? (
        <Textarea
          id={id}
          rows={3}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          placeholder={
            hint ? t("settings.app.integrations.apiKeyPlaceholder") : ""
          }
          value={shown}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          type="password"
          autoComplete="off"
          className="font-mono"
          placeholder={
            hint ? t("settings.app.integrations.apiKeyPlaceholder") : ""
          }
          value={shown}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      )}
      {hint && value !== null ? (
        <FieldDescription className="flex flex-wrap gap-x-3">
          <span>{t("settings.app.integrations.apiKeySet", { hint })}</span>
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => onChange(null)}
          >
            {t("settings.app.integrations.clear")}
          </button>
        </FieldDescription>
      ) : null}
    </>
  )
}

function EmailCard({ data }: { data: AdminSettings }) {
  const { t } = useTranslation()
  const save = useSaveSettings()
  const draft = useDraft<EmailDraft>(data.email)
  const test = useMutation<{ to: string }, ApiError>({
    mutationFn: () => api.post("/api/admin/settings/test-email"),
    onSuccess: (r) =>
      toast.success(t("settings.app.notify.testSent", { email: r.to })),
    onError: (err) =>
      toast.error(t("settings.app.notify.testFailed", { error: err.message })),
  })
  const e = draft.value

  return (
    <SettingsCard
      title={t("settings.app.notify.emailTitle")}
      description={t("settings.app.notify.emailBody")}
      dirty={draft.dirty}
      saving={save.isPending}
      onSave={() => {
        const { resendApiKey, ...email } = e
        save.mutate(
          {
            email,
            secrets: resendApiKey === undefined ? {} : { resendApiKey },
          },
          { onSuccess: () => draft.reset() }
        )
      }}
      onReset={draft.reset}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="resend-key">
            {t("settings.app.notify.resendKey")}
          </FieldLabel>
          <SecretInput
            id="resend-key"
            value={e.resendApiKey}
            hint={data.secrets.resendApiKey}
            onChange={(v) => draft.set("resendApiKey", v)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="mail-from">
            {t("settings.app.notify.from")}
          </FieldLabel>
          <Input
            id="mail-from"
            maxLength={200}
            placeholder={data.effective.mail.from}
            value={e.from ?? ""}
            onChange={(ev) => draft.set("from", ev.target.value)}
          />
          <FieldDescription>
            {t("settings.app.notify.fromHint")}
          </FieldDescription>
        </Field>
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={
              !data.secrets.resendApiKey || draft.dirty || test.isPending
            }
            onClick={() => test.mutate()}
          >
            {test.isPending ? <Spinner /> : <MailIcon />}
            {t("settings.app.notify.testEmail")}
          </Button>
        </div>
      </FieldGroup>
    </SettingsCard>
  )
}

const PUSH_FIELDS = [
  { key: "projectId", label: "settings.app.notify.projectId" },
  { key: "clientEmail", label: "settings.app.notify.clientEmail" },
  { key: "apiKey", label: "settings.app.notify.apiKey" },
  { key: "appId", label: "settings.app.notify.appId" },
  { key: "messagingSenderId", label: "settings.app.notify.senderId" },
  { key: "vapidKey", label: "settings.app.notify.vapidKey" },
] as const satisfies { key: keyof PushConfig; label: string }[]

function PushCard({ data }: { data: AdminSettings }) {
  const { t } = useTranslation()
  const save = useSaveSettings()
  const draft = useDraft<PushDraft>(data.push)
  const p = draft.value
  const enabled = data.effective.firebase.enabled

  return (
    <SettingsCard
      title={t("settings.app.notify.pushTitle")}
      description={t("settings.app.notify.pushBody")}
      dirty={draft.dirty}
      saving={save.isPending}
      onSave={() => {
        const { firebasePrivateKey, ...push } = p
        save.mutate(
          {
            push,
            secrets:
              firebasePrivateKey === undefined ? {} : { firebasePrivateKey },
          },
          { onSuccess: () => draft.reset() }
        )
      }}
      onReset={draft.reset}
    >
      <Badge variant={enabled ? "secondary" : "outline"} className="self-start">
        {enabled
          ? t("settings.app.notify.enabled")
          : t("settings.app.notify.disabled")}
      </Badge>
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          {PUSH_FIELDS.map(({ key, label }) => (
            <Field key={key}>
              <FieldLabel htmlFor={`push-${key}`}>{t(label)}</FieldLabel>
              <Input
                id={`push-${key}`}
                maxLength={key === "clientEmail" ? 320 : 200}
                autoComplete="off"
                className="font-mono"
                placeholder={data.effective.firebase[key] || ""}
                value={p[key] ?? ""}
                onChange={(e) => draft.set(key, e.target.value.trim())}
              />
            </Field>
          ))}
        </div>
        <Field>
          <FieldLabel htmlFor="push-private-key">
            {t("settings.app.notify.privateKey")}
          </FieldLabel>
          <SecretInput
            id="push-private-key"
            multiline
            value={p.firebasePrivateKey}
            hint={data.secrets.firebasePrivateKey}
            onChange={(v) => draft.set("firebasePrivateKey", v)}
          />
          <FieldDescription>
            {t("settings.app.notify.privateKeyHint")}
          </FieldDescription>
        </Field>
      </FieldGroup>
    </SettingsCard>
  )
}
