import { useMutation } from "@tanstack/react-query"
import { CheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { type ApiError, api } from "@/lib/api-client"
import {
  type AdminSettings,
  type CaptionProviderId,
  SettingsCard,
  SettingsSkeleton,
  type SecretName,
  useAdminSettings,
  useDraft,
  useSaveSettings,
} from "./app-settings-form"

type Draft = AdminSettings["captions"] & {
  sonioxApiKey?: string | null
  geminiApiKey?: string | null
}

const PROVIDERS: CaptionProviderId[] = ["soniox", "gemini", "off"]

/** Settings → Integrations: the live caption service, its API key and models. */
export function IntegrationsSettings() {
  const { t } = useTranslation()
  const { data } = useAdminSettings()
  const save = useSaveSettings()
  const draft = useDraft<Draft>(data?.captions)
  const test = useMutation<
    unknown,
    ApiError,
    { provider: "soniox" | "gemini"; apiKey?: string }
  >({
    mutationFn: ({ provider, apiKey }) =>
      api.post(`/api/admin/settings/test/${provider}`, { apiKey }),
    onSuccess: () => toast.success(t("settings.app.integrations.testOk")),
    onError: (err) =>
      toast.error(
        t("settings.app.integrations.testFailed", { error: err.message })
      ),
  })
  if (!data) return <SettingsSkeleton />
  const c = draft.value
  const provider = c.provider ?? data.effective.caption.provider
  const keyName: "sonioxApiKey" | "geminiApiKey" | null =
    provider === "soniox"
      ? "sonioxApiKey"
      : provider === "gemini"
        ? "geminiApiKey"
        : null
  const typedKey = keyName ? c[keyName] : undefined
  const savedHint = keyName ? data.secrets[keyName] : null
  const hasKey = typedKey !== null && Boolean(typedKey || savedHint)

  const submit = () => {
    const { sonioxApiKey, geminiApiKey, ...captions } = c
    const secrets: Partial<Record<SecretName, string | null>> = {}
    if (sonioxApiKey !== undefined) secrets.sonioxApiKey = sonioxApiKey
    if (geminiApiKey !== undefined) secrets.geminiApiKey = geminiApiKey
    save.mutate(
      { captions: { ...captions, provider }, secrets },
      { onSuccess: () => draft.reset() }
    )
  }

  const model = (key: keyof AdminSettings["captions"], label: string) => (
    <Field>
      <FieldLabel htmlFor={`caption-${key}`}>{label}</FieldLabel>
      <Input
        id={`caption-${key}`}
        maxLength={80}
        className="font-mono"
        placeholder={data.effective.caption[key] as string}
        value={(c[key] as string | undefined) ?? ""}
        onChange={(e) => draft.set(key, e.target.value.trim())}
      />
    </Field>
  )

  return (
    <SettingsCard
      title={t("settings.app.integrations.title")}
      description={t("settings.app.integrations.body")}
      dirty={draft.dirty}
      saving={save.isPending}
      onSave={submit}
      onReset={draft.reset}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="caption-provider">
            {t("settings.app.integrations.provider")}
          </FieldLabel>
          <NativeSelect
            id="caption-provider"
            value={provider}
            onChange={(e) =>
              draft.set("provider", e.target.value as CaptionProviderId)
            }
          >
            {PROVIDERS.map((p) => (
              <NativeSelectOption key={p} value={p}>
                {t(`settings.app.integrations.providers.${p}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        {keyName && provider !== "off" ? (
          <>
            <Field>
              <FieldLabel htmlFor="caption-key">
                {t("settings.app.integrations.apiKey")}
              </FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="caption-key"
                  type="password"
                  autoComplete="off"
                  className="font-mono"
                  placeholder={
                    savedHint
                      ? t("settings.app.integrations.apiKeyPlaceholder")
                      : ""
                  }
                  value={typedKey ?? ""}
                  onChange={(e) => draft.set(keyName, e.target.value.trim())}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!hasKey || test.isPending}
                  onClick={() =>
                    test.mutate({
                      provider,
                      apiKey: typedKey || undefined,
                    })
                  }
                >
                  {test.isPending ? (
                    <Spinner />
                  ) : test.isSuccess ? (
                    <CheckIcon />
                  ) : null}
                  {t("settings.app.integrations.test")}
                </Button>
              </div>
              <FieldDescription className="flex flex-wrap items-center gap-x-3">
                {savedHint && typedKey !== null ? (
                  <>
                    <span>
                      {t("settings.app.integrations.apiKeySet", {
                        hint: savedHint,
                      })}
                    </span>
                    <button
                      type="button"
                      className="underline underline-offset-4"
                      onClick={() => draft.set(keyName, null)}
                    >
                      {t("settings.app.integrations.clear")}
                    </button>
                  </>
                ) : (
                  t("settings.app.integrations.noKey")
                )}
              </FieldDescription>
            </Field>
            {provider === "soniox" ? (
              model("sonioxModel", t("settings.app.integrations.model"))
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                {model(
                  "geminiTranscribeModel",
                  t("settings.app.integrations.transcribeModel")
                )}
                {model(
                  "geminiTranslateModel",
                  t("settings.app.integrations.translateModel")
                )}
              </div>
            )}
          </>
        ) : null}
      </FieldGroup>
    </SettingsCard>
  )
}
