import { format } from "date-fns"
import {
  CalendarIcon,
  ImageIcon,
  PencilIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { type FormEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { RichText } from "@/components/common/rich-text"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useApp } from "@/hooks/use-app"
import { errorMessage, useDateLocale } from "@/lib/i18n"
import { db } from "@/lib/api-client"
import { useDbMutation } from "@/lib/query"
import { fileUrl, uploadFile } from "@/lib/upload"
import type { GroupPrivacy } from "@app/api/zenstack/models"
import {
  type GroupFeatures,
  GroupFeaturesFields,
} from "./group-features-fields"
import type { GroupWithMe } from "./group-query"
import { GroupCover, PrivacyLabel } from "./group-visuals"
import { PrivacyPicker } from "./privacy-picker"
import { ScrollArea } from "@/components/ui/scroll-area"

/** Group admins (and instance admins) edit the group; policies enforce the same rule. */
export function useCanAdminGroup(group: GroupWithMe) {
  const { isAdmin } = useApp()
  const m = group.members[0]
  return isAdmin || (m?.status === "ACTIVE" && m.role === "ADMIN")
}

export function GroupAbout({ group }: { group: GroupWithMe }) {
  const { t } = useTranslation()
  const locale = useDateLocale()
  const canEdit = useCanAdminGroup(group)
  const [editing, setEditing] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("groups.about")}</CardTitle>
        {canEdit ? (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <PencilIcon />
              {t("common.edit")}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {group.description ? (
          <RichText text={group.description} className="text-sm" />
        ) : (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              {canEdit
                ? t("groups.aboutTab.descriptionHint")
                : t("groups.noDescription")}
            </p>
            {canEdit ? (
              <Button size="sm" variant="soft" onClick={() => setEditing(true)}>
                <PencilIcon />
                {t("groups.aboutTab.addDescription")}
              </Button>
            ) : null}
          </div>
        )}
        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex flex-col gap-0.5">
            <PrivacyLabel privacy={group.privacy} className="font-medium" />
            <span className="pl-5 text-muted-foreground">
              {t(`groups.privacyDescription.${group.privacy}`)}
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <UsersIcon className="size-3.5 text-muted-foreground" aria-hidden />
            {t("groups.memberCount", { count: group._count.members })}
          </li>
          <li className="flex items-center gap-1.5">
            <CalendarIcon
              className="size-3.5 text-muted-foreground"
              aria-hidden
            />
            {group.isDefault
              ? t("groups.aboutTab.created", {
                  date: format(group.createdAt, "PPP", { locale }),
                })
              : t("groups.aboutTab.createdBy", {
                  date: format(group.createdAt, "PPP", { locale }),
                  name: group.createdBy.name,
                })}
          </li>
        </ul>
      </CardContent>
      {canEdit && editing ? (
        <EditGroupDialog group={group} open onOpenChange={setEditing} />
      ) : null}
    </Card>
  )
}

type Draft = {
  name: string
  description: string
  privacy: GroupPrivacy
  coverUrl: string | null
  features: GroupFeatures
}

export function EditGroupDialog({
  group,
  open,
  onOpenChange,
}: {
  group: GroupWithMe
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft>(() => ({
    name: group.name,
    description: group.description ?? "",
    privacy: group.privacy,
    coverUrl: group.coverUrl,
    features: {
      wikiEnabled: group.wikiEnabled,
      channelsEnabled: group.channelsEnabled,
      calendarEnabled: group.calendarEnabled,
      postPolicy: group.postPolicy,
      wikiEditPolicy: group.wikiEditPolicy,
    },
  }))
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const coverRef = useRef<HTMLInputElement>(null)

  const save = useDbMutation(
    (d: Draft) =>
      db.group.update({
        where: { id: group.id },
        data: {
          name: d.name.trim(),
          description: d.description.trim() || null,
          coverUrl: d.coverUrl,
          ...d.features,
          ...(group.isDefault ? {} : { privacy: d.privacy }),
        },
      }),
    { invalidates: ["group", "groupMember", "post"] }
  )
  const remove = useDbMutation(
    () => db.group.delete({ where: { id: group.id } }),
    {
      invalidates: ["group", "groupMember", "post"],
    }
  )

  const onCover = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error(t("groups.edit.chooseImage"))
      return
    }
    setUploading(true)
    try {
      const attachment = await uploadFile(file, { isPublic: true })
      setDraft((d) => ({ ...d, coverUrl: fileUrl(attachment.id) }))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim()) return
    save.mutate(draft, {
      onSuccess: () => {
        toast.success(t("groups.edit.updated"))
        onOpenChange(false)
      },
      onError: (err) => toast.error(errorMessage(err)),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-lg">
        <ScrollArea
          className="rounded-[inherit]"
          viewportClassName="max-h-[90svh]"
        >
          <div className="grid gap-6 p-6">
            <form onSubmit={submit} className="flex flex-col gap-6">
              <DialogHeader>
                <DialogTitle>{t("groups.editGroup")}</DialogTitle>
                <DialogDescription>
                  {t("groups.edit.description")}
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel>{t("groups.edit.cover")}</FieldLabel>
                  <div className="relative overflow-hidden rounded-lg border">
                    <GroupCover
                      group={{
                        name: draft.name || group.name,
                        coverUrl: draft.coverUrl,
                      }}
                      className="h-28"
                    />
                    <div className="absolute right-2 bottom-2 flex gap-2">
                      {draft.coverUrl ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setDraft({ ...draft, coverUrl: null })}
                        >
                          {t("common.remove")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={uploading}
                        onClick={() => coverRef.current?.click()}
                      >
                        {uploading ? <Spinner /> : <ImageIcon />}
                        {draft.coverUrl
                          ? t("groups.edit.change")
                          : t("groups.edit.upload")}
                      </Button>
                    </div>
                  </div>
                  <input
                    ref={coverRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={(e) => {
                      void onCover(e.target.files?.[0])
                      e.target.value = ""
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-group-name">
                    {t("groups.form.name")}
                  </FieldLabel>
                  <Input
                    id="edit-group-name"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                    maxLength={80}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-group-description">
                    {t("groups.form.description")}
                  </FieldLabel>
                  <Textarea
                    id="edit-group-description"
                    value={draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                    rows={4}
                    maxLength={1000}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("groups.form.privacy")}</FieldLabel>
                  <PrivacyPicker
                    idPrefix="edit-privacy"
                    value={draft.privacy}
                    onChange={(privacy) => setDraft({ ...draft, privacy })}
                    disabled={group.isDefault}
                  />
                  {group.isDefault ? (
                    <FieldDescription>
                      {t("groups.edit.defaultPrivacy")}
                    </FieldDescription>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel>{t("groups.features.title")}</FieldLabel>
                  <GroupFeaturesFields
                    idPrefix="edit-features"
                    value={draft.features}
                    onChange={(features) => setDraft({ ...draft, features })}
                  />
                  <FieldDescription>
                    {t("groups.features.keptHint")}
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <DialogFooter className="sm:justify-between">
                {group.isDefault ? (
                  <span />
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2Icon />
                    {t("groups.edit.delete")}
                  </Button>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    type="submit"
                    disabled={!draft.name.trim() || save.isPending || uploading}
                  >
                    {save.isPending ? <Spinner /> : null}
                    {t("groups.edit.save")}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </div>
        </ScrollArea>
      </DialogContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("groups.edit.deleteTitle", { name: group.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("groups.edit.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast.success(t("groups.edit.deleted"))
                    onOpenChange(false)
                    void navigate("/groups")
                  },
                  onError: (err) => toast.error(errorMessage(err)),
                })
              }
            >
              {t("groups.edit.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
