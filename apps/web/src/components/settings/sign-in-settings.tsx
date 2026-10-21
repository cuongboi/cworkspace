import { SOCIAL_PROVIDERS, type SocialProvider } from "@app/shared/app-config"
import { CopyIcon } from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import { COMPANY_NAME } from "@/lib/company"
import {
  type AdminSettings,
  SettingsCard,
  SettingsSkeleton,
  type SecretName,
  useAdminSettings,
  useDraft,
  useSaveSettings,
} from "./app-settings-form"

type Entry = { enabled: boolean; clientId: string; secret?: string | null }
type Draft = Partial<Record<SocialProvider, Entry>>

const secretOf = (p: SocialProvider): SecretName => `${p}ClientSecret`

/** Settings → Sign-in: Google, GitHub and LINE (OAuth apps registered by the admin). */
export function SignInSettings() {
  const { t } = useTranslation()
  const { data } = useAdminSettings()
  const save = useSaveSettings()
  const draft = useDraft<Draft>(data?.social)
  if (!data) return <SettingsSkeleton />
  const value = draft.value

  const entry = (p: SocialProvider): Entry =>
    value[p] ?? { enabled: false, clientId: "" }
  const update = (p: SocialProvider, patch: Partial<Entry>) =>
    draft.set(p, { ...entry(p), ...patch })

  const submit = () => {
    const social: AdminSettings["social"] = {}
    const secrets: Partial<Record<SecretName, string | null>> = {}
    for (const p of SOCIAL_PROVIDERS) {
      const { secret, ...rest } = entry(p)
      social[p] = rest
      if (secret !== undefined) secrets[secretOf(p)] = secret
    }
    save.mutate({ social, secrets }, { onSuccess: () => draft.reset() })
  }

  return (
    <SettingsCard
      title={t("settings.app.signIn.title")}
      description={t("settings.app.signIn.body", { company: COMPANY_NAME })}
      dirty={draft.dirty}
      saving={save.isPending}
      onSave={submit}
      onReset={draft.reset}
    >
      {SOCIAL_PROVIDERS.map((p) => {
        const e = entry(p)
        const savedHint = data.secrets[secretOf(p)]
        const hasSecret = e.secret !== null && Boolean(e.secret || savedHint)
        const callback = `${data.callbackUrl}${p}`
        return (
          <FieldGroup key={p} className="border-b pb-5 last:border-b-0">
            <div className="flex items-center gap-3">
              <h3 className="font-medium">
                {t(`settings.app.signIn.providers.${p}`)}
              </h3>
              {e.enabled && !(e.clientId && hasSecret) ? (
                <Badge variant="outline">
                  {t("settings.app.signIn.incomplete")}
                </Badge>
              ) : null}
              <Switch
                className="ml-auto"
                aria-label={t("settings.app.signIn.enabled")}
                checked={e.enabled}
                onCheckedChange={(enabled) => update(p, { enabled })}
              />
            </div>
            {e.enabled ? (
              <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`${p}-client-id`}>
                      {t("settings.app.signIn.clientId")}
                    </FieldLabel>
                    <Input
                      id={`${p}-client-id`}
                      className="font-mono"
                      autoComplete="off"
                      value={e.clientId}
                      onChange={(ev) =>
                        update(p, { clientId: ev.target.value.trim() })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${p}-client-secret`}>
                      {t("settings.app.signIn.clientSecret")}
                    </FieldLabel>
                    <Input
                      id={`${p}-client-secret`}
                      type="password"
                      className="font-mono"
                      autoComplete="off"
                      placeholder={savedHint ?? ""}
                      value={e.secret ?? ""}
                      onChange={(ev) =>
                        update(p, { secret: ev.target.value.trim() })
                      }
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor={`${p}-callback`}>
                    {t("settings.app.signIn.callbackUrl")}
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id={`${p}-callback`}
                      readOnly
                      value={callback}
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("settings.app.signIn.callbackUrl")}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(callback)
                          .then(() =>
                            toast.success(t("settings.app.signIn.copied"))
                          )
                      }
                    >
                      <CopyIcon />
                    </Button>
                  </div>
                  <FieldDescription>
                    {t("settings.app.signIn.callbackHint")}
                  </FieldDescription>
                </Field>
              </>
            ) : null}
          </FieldGroup>
        )
      })}
    </SettingsCard>
  )
}
