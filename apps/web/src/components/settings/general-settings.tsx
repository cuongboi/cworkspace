import { ImageIcon, UploadIcon, XIcon } from "lucide-react"
import { useRef, useState } from "react"
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
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { COMPANY_NAME } from "@/lib/company"
import { uploadFile } from "@/lib/upload"
import {
  type AdminSettings,
  SettingsCard,
  SettingsSkeleton,
  useAdminSettings,
  useDraft,
  useSaveSettings,
} from "./app-settings-form"

type Branding = AdminSettings["branding"]

/** Settings → General: name, description, icon and link previews (Open Graph). */
export function GeneralSettings() {
  const { t } = useTranslation()
  const { data } = useAdminSettings()
  const save = useSaveSettings()
  const draft = useDraft<Branding>(data?.branding)
  if (!data) return <SettingsSkeleton />
  const b = draft.value
  const env = data.effective.app

  const text = (key: keyof Branding) => ({
    value: (b[key] as string | undefined) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      draft.set(key, e.target.value),
  })
  const submit = () =>
    save.mutate({ branding: b }, { onSuccess: () => draft.reset() })

  return (
    <SettingsCard
      title={t("settings.app.general.title")}
      description={t("settings.app.general.body", { company: COMPANY_NAME })}
      dirty={draft.dirty}
      saving={save.isPending}
      onSave={submit}
      onReset={draft.reset}
    >
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="app-name">
              {t("settings.app.general.name")}
            </FieldLabel>
            <Input
              id="app-name"
              maxLength={60}
              placeholder={env.name}
              {...text("name")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="app-short-name">
              {t("settings.app.general.shortName")}
            </FieldLabel>
            <Input
              id="app-short-name"
              maxLength={30}
              placeholder={env.shortName}
              {...text("shortName")}
            />
            <FieldDescription>
              {t("settings.app.general.shortNameHint")}
            </FieldDescription>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="app-description">
            {t("settings.app.general.description")}
          </FieldLabel>
          <Textarea
            id="app-description"
            maxLength={300}
            rows={2}
            placeholder={env.description}
            {...text("description")}
          />
        </Field>
        <ImageField
          label={t("settings.app.general.icon")}
          hint={t("settings.app.general.iconHint")}
          url={b.icon}
          square
          onUploaded={(id) => draft.replace({ ...b, iconFile: id })}
          onRemove={() => draft.replace({ ...b, icon: "", iconFile: null })}
          pending={Boolean(b.iconFile && b.iconFile !== data.branding.iconFile)}
        />
      </FieldGroup>

      <div className="flex flex-col gap-1 border-t pt-5">
        <h3 className="font-medium">{t("settings.app.general.shareTitle")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("settings.app.general.shareBody", { company: COMPANY_NAME })}
        </p>
      </div>
      <FieldGroup>
        <ImageField
          label={t("settings.app.general.ogImage")}
          hint={t("settings.app.general.ogImageHint")}
          url={b.ogImage}
          onUploaded={(id) => draft.replace({ ...b, ogImageFile: id })}
          onRemove={() =>
            draft.replace({ ...b, ogImage: "", ogImageFile: null })
          }
          pending={Boolean(
            b.ogImageFile && b.ogImageFile !== data.branding.ogImageFile
          )}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="app-locale">
              {t("settings.app.general.locale")}
            </FieldLabel>
            <Input
              id="app-locale"
              maxLength={10}
              placeholder={env.locale}
              {...text("locale")}
            />
            <FieldDescription>
              {t("settings.app.general.localeHint")}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="app-twitter">
              {t("settings.app.general.twitterSite")}
            </FieldLabel>
            <Input
              id="app-twitter"
              maxLength={16}
              placeholder="@handle"
              {...text("twitterSite")}
            />
            <FieldDescription>
              {t("settings.app.general.twitterSiteHint")}
            </FieldDescription>
          </Field>
        </div>
      </FieldGroup>
    </SettingsCard>
  )
}

/** An uploaded branding image: the file goes to storage now, the setting changes on Save. */
function ImageField({
  label,
  hint,
  url,
  square,
  pending,
  onUploaded,
  onRemove,
}: {
  label: string
  hint: string
  url: string | undefined
  square?: boolean
  /** uploaded, not saved yet */
  pending: boolean
  onUploaded: (attachmentId: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const shown = pending ? preview : url || null

  const pick = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const attachment = await uploadFile(file, { isPublic: true })
      setPreview(URL.createObjectURL(file))
      onUploaded(attachment.id)
    } catch (err) {
      toast.error(t("settings.app.uploadFailed"), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ""
    }
  }

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-4">
        <div
          className={
            square
              ? "flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted"
              : "flex aspect-[1200/630] w-40 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted"
          }
        >
          {shown ? (
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            {uploading ? <Spinner /> : <UploadIcon />}
            {t("settings.app.upload")}
          </Button>
          {shown ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPreview(null)
                onRemove()
              }}
            >
              <XIcon />
              {t("settings.app.remove")}
            </Button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      <FieldDescription>{hint}</FieldDescription>
    </Field>
  )
}
