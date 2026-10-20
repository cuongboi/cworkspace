import { CameraIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"
import { UserAvatar } from "@/components/common/user-avatar"
import { AutoForm, type AutoFormSchema } from "@/components/ui/auto-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { authClient } from "@/lib/auth-client"
import { useDbMutation } from "@/lib/query"
import { fileUrl, uploadFile } from "@/lib/upload"
import { ScrollArea } from "@/components/ui/scroll-area"

export type EditableProfile = {
  name: string
  email: string
  image: string | null
  title: string | null
  department: string | null
  location: string | null
  phone: string | null
  bio: string | null
}

const optionalText = (max: number) => z.string().trim().max(max)

const shape = {
  name: z.string().trim().max(100),
  email: z.string(),
  title: optionalText(100),
  department: optionalText(100),
  location: optionalText(100),
  phone: optionalText(40),
  bio: optionalText(1000),
}
type Draft = z.infer<z.ZodObject<typeof shape>>

const FULL_WIDTH = { container: "sm:col-span-2" }

/** Edits my own profile (`db.user.update` on my row; email is immutable). Mount it only while open. */
export function EditProfileDialog({
  profile,
  onOpenChange,
}: {
  profile: EditableProfile
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { me } = useApp()
  const session = authClient.useSession()
  const schema: AutoFormSchema<typeof shape> = useMemo(
    () => ({
      name: {
        schema: shape.name.min(1, t("people.edit.nameRequired")),
        label: t("people.edit.fullName"),
        as: Input,
        classNames: FULL_WIDTH,
      },
      email: {
        schema: shape.email,
        label: t("people.edit.email"),
        as: Input,
        disabled: true,
        description: t("people.edit.emailHint"),
        classNames: FULL_WIDTH,
      },
      title: {
        schema: shape.title,
        label: t("people.edit.jobTitle"),
        as: Input,
        placeholder: t("people.edit.jobTitlePlaceholder"),
      },
      department: {
        schema: shape.department,
        label: t("people.edit.department"),
        as: Input,
        placeholder: t("people.edit.departmentPlaceholder"),
      },
      location: {
        schema: shape.location,
        label: t("people.edit.location"),
        as: Input,
        placeholder: t("people.edit.locationPlaceholder"),
      },
      phone: {
        schema: shape.phone,
        label: t("people.edit.phone"),
        as: Input,
        placeholder: "+84 …",
        meta: { type: "tel" },
      },
      bio: {
        schema: shape.bio,
        label: t("people.edit.bio"),
        as: Textarea,
        placeholder: t("people.edit.bioPlaceholder"),
        meta: { rows: 4 },
        classNames: FULL_WIDTH,
      },
    }),
    [t]
  )
  const defaultValues = useMemo(
    () => ({
      name: profile.name,
      email: profile.email,
      title: profile.title ?? "",
      department: profile.department ?? "",
      location: profile.location ?? "",
      phone: profile.phone ?? "",
      bio: profile.bio ?? "",
    }),
    [profile]
  )
  const [image, setImage] = useState(profile.image)
  const [uploading, setUploading] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)

  const save = useDbMutation(
    (d: Draft) =>
      db.user.update({
        where: { id: me.id },
        data: {
          name: d.name,
          image,
          title: d.title || null,
          department: d.department || null,
          location: d.location || null,
          phone: d.phone || null,
          bio: d.bio || null,
        },
      }),
    { invalidates: ["user", "post", "comment", "groupMember"] }
  )

  const onAvatar = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error(t("people.edit.chooseImage"))
      return
    }
    setUploading(true)
    try {
      const attachment = await uploadFile(file, { isPublic: true })
      setImage(fileUrl(attachment.id))
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t("people.edit.uploadFailed")
      )
    } finally {
      setUploading(false)
    }
  }

  const submit = (draft: Draft) =>
    save.mutate(draft, {
      onSuccess: () => {
        toast.success(t("people.edit.updated"))
        // the sidebar reads name/avatar from the session
        void session.refetch()
        onOpenChange(false)
      },
      onError: (err) => toast.error(errorMessage(err)),
    })

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-lg">
        <ScrollArea
          className="rounded-[inherit]"
          viewportClassName="max-h-[90svh]"
        >
          <div className="grid gap-6 p-6">
            <DialogHeader>
              <DialogTitle>{t("people.edit.title")}</DialogTitle>
              <DialogDescription>
                {t("people.edit.description")}
              </DialogDescription>
            </DialogHeader>
            <AutoForm
              schema={schema}
              defaultValues={defaultValues}
              onSubmit={submit}
              className="grid gap-4 sm:grid-cols-2"
              panels={[
                {
                  before: "name",
                  // the avatar fallback shows the initials of the typed name
                  watch: ["name"],
                  render: ({ form }) => (
                    <div className="flex items-center gap-4 sm:col-span-2">
                      <UserAvatar
                        user={{ name: form.getValues("name"), image }}
                        size="xl"
                      />
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading}
                            onClick={() => avatarRef.current?.click()}
                          >
                            {uploading ? <Spinner /> : <CameraIcon />}
                            {t("people.edit.changePhoto")}
                          </Button>
                          {image ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setImage(null)}
                            >
                              {t("common.remove")}
                            </Button>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("people.edit.photoFormats")}
                        </p>
                      </div>
                      <input
                        ref={avatarRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        hidden
                        onChange={(e) => {
                          void onAvatar(e.target.files?.[0])
                          e.target.value = ""
                        }}
                      />
                    </div>
                  ),
                },
              ]}
            >
              <DialogFooter className="sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={save.isPending || uploading}>
                  {save.isPending ? <Spinner /> : null}
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </AutoForm>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
