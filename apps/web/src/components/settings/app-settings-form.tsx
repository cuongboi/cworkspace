import type { AppConfig, SocialProvider } from "@app/shared/app-config"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ApiError, api } from "@/lib/api-client"

/** Instance settings as `GET /api/admin/settings` answers them (secrets only as hints). */
export type CaptionProviderId = "soniox" | "gemini" | "off"
export type PushConfig = {
  projectId?: string
  clientEmail?: string
  apiKey?: string
  appId?: string
  messagingSenderId?: string
  vapidKey?: string
}

export type SecretName =
  | "sonioxApiKey"
  | "geminiApiKey"
  | "googleClientSecret"
  | "githubClientSecret"
  | "lineClientSecret"
  | "resendApiKey"
  | "firebasePrivateKey"

export type AdminSettings = {
  branding: {
    name?: string
    shortName?: string
    description?: string
    locale?: string
    twitterSite?: string
    ogImage?: string
    icon?: string
    iconFile?: string | null
    ogImageFile?: string | null
  }
  captions: {
    provider?: CaptionProviderId
    sonioxModel?: string
    geminiTranscribeModel?: string
    geminiTranslateModel?: string
  }
  email: { from?: string }
  push: PushConfig
  social: Partial<
    Record<SocialProvider, { enabled: boolean; clientId: string }>
  >
  effective: {
    app: AppConfig
    mail: { from: string }
    firebase: Required<PushConfig> & { enabled: boolean }
    caption: {
      provider: CaptionProviderId
      sonioxModel: string
      geminiTranscribeModel: string
      geminiTranslateModel: string
    }
  }
  secrets: Record<SecretName, string | null>
  callbackUrl: string
}

export type SettingsPatch = Partial<
  Pick<AdminSettings, "branding" | "captions" | "social" | "email" | "push">
> & { secrets?: Partial<Record<SecretName, string | null>> }

const KEY = ["appSetting", "admin"]

export function useAdminSettings() {
  return useQuery<AdminSettings, ApiError>({
    queryKey: KEY,
    queryFn: () => api.get<AdminSettings>("/api/admin/settings"),
  })
}

export function useSaveSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  return useMutation<AdminSettings, ApiError, SettingsPatch>({
    mutationFn: (patch) =>
      api.patch<AdminSettings>("/api/admin/settings", patch),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data)
      toast.success(t("settings.app.saved"))
    },
    onError: (err) =>
      toast.error(t("settings.app.saveFailed"), { description: err.message }),
  })
}

/**
 * A settings card editing a draft of one section: Save sends it, Discard drops it. The draft
 * starts from the saved values and is only kept while it differs from them.
 */
export function useDraft<T extends object>(saved: T | undefined) {
  const [draft, setDraft] = useState<T | null>(null)
  const value = (draft ?? saved ?? ({} as T)) as T
  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(saved)
  return {
    value,
    dirty,
    set: <K extends keyof T>(key: K, v: T[K]) =>
      setDraft({ ...value, [key]: v }),
    replace: (next: T) => setDraft(next),
    reset: () => setDraft(null),
  }
}

export function SettingsCard({
  title,
  description,
  children,
  dirty,
  saving,
  onSave,
  onReset,
}: {
  title: string
  description?: string
  children: ReactNode
  dirty: boolean
  saving: boolean
  onSave: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
      <CardFooter className="justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={!dirty || saving}
          onClick={onReset}
        >
          {t("settings.app.reset")}
        </Button>
        <Button type="button" disabled={!dirty || saving} onClick={onSave}>
          {saving ? <Spinner /> : null}
          {t("settings.app.save")}
        </Button>
      </CardFooter>
    </Card>
  )
}

export function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  )
}
