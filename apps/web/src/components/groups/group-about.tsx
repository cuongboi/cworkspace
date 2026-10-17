import { format } from "date-fns"
import {
  CalendarIcon,
  ImageIcon,
  PencilIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react"
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { useDbMutation } from "@/lib/query"
import { fileUrl, uploadFile } from "@/lib/upload"
import type { GroupPrivacy, WikiEditPolicy } from "@app/api/zenstack/models"
import { type GroupWithMe, PRIVACY_DESCRIPTION } from "./group-query"
import { GroupCover, PrivacyLabel } from "./group-visuals"
import { PrivacyPicker } from "./privacy-picker"
import { ScrollArea } from "@/components/ui/scroll-area"

/** Group admins (and org admins) edit the group; policies enforce the same rule. */
export function useCanAdminGroup(group: GroupWithMe) {
  const { isAdmin } = useOrg()
  const m = group.members[0]
  return isAdmin || (m?.status === "ACTIVE" && m.role === "ADMIN")
}

export function GroupAbout({ group }: { group: GroupWithMe }) {
  const canEdit = useCanAdminGroup(group)
  const [editing, setEditing] = useState(false)

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle>About this group</CardTitle>
        {canEdit ? (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <PencilIcon />
              Edit
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4">
        {group.description ? (
          <RichText text={group.description} className="text-sm" />
        ) : (
          <p className="text-sm text-muted-foreground">No description yet.</p>
        )}
        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex flex-col gap-0.5">
            <PrivacyLabel privacy={group.privacy} className="font-medium" />
            <span className="pl-5 text-muted-foreground">
              {PRIVACY_DESCRIPTION[group.privacy]}
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <UsersIcon className="size-3.5 text-muted-foreground" aria-hidden />
            {group._count.members} member{group._count.members === 1 ? "" : "s"}
          </li>
          <li className="flex items-center gap-1.5">
            <CalendarIcon
              className="size-3.5 text-muted-foreground"
              aria-hidden
            />
            Created {format(group.createdAt, "MMMM d, yyyy")}
            {group.isDefault ? "" : ` by ${group.createdBy.name}`}
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
  wikiEditPolicy: WikiEditPolicy
  coverUrl: string | null
}

function EditGroupDialog({
  group,
  open,
  onOpenChange,
}: {
  group: GroupWithMe
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { org, href } = useOrg()
  const [draft, setDraft] = useState<Draft>(() => ({
    name: group.name,
    description: group.description ?? "",
    privacy: group.privacy,
    wikiEditPolicy: group.wikiEditPolicy,
    coverUrl: group.coverUrl,
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
          wikiEditPolicy: d.wikiEditPolicy,
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
      toast.error("Choose an image")
      return
    }
    setUploading(true)
    try {
      const attachment = await uploadFile(file, org.id, { orgVisible: true })
      setDraft((d) => ({ ...d, coverUrl: fileUrl(attachment.id) }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim()) return
    save.mutate(draft, {
      onSuccess: () => {
        toast.success("Group updated")
        onOpenChange(false)
      },
      onError: (err) => toast.error(err.message),
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
                <DialogTitle>Edit group</DialogTitle>
                <DialogDescription>
                  Changes are visible to everyone who can see the group.
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel>Cover photo</FieldLabel>
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
                          Remove
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
                        {draft.coverUrl ? "Change" : "Upload"}
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
                  <FieldLabel htmlFor="edit-group-name">Name</FieldLabel>
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
                    Description
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
                  <FieldLabel>Privacy</FieldLabel>
                  <PrivacyPicker
                    idPrefix="edit-privacy"
                    value={draft.privacy}
                    onChange={(privacy) => setDraft({ ...draft, privacy })}
                    disabled={group.isDefault}
                  />
                  {group.isDefault ? (
                    <FieldDescription>
                      The company-wide group is always visible to everyone.
                    </FieldDescription>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="edit-wiki-policy">
                    Who can edit Knowledge
                  </FieldLabel>
                  <NativeSelect
                    id="edit-wiki-policy"
                    value={draft.wikiEditPolicy}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        wikiEditPolicy: e.target.value as WikiEditPolicy,
                      })
                    }
                    className="w-full"
                  >
                    <NativeSelectOption value="MEMBERS">
                      All members
                    </NativeSelectOption>
                    <NativeSelectOption value="ADMINS">
                      Admins and moderators
                    </NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription>
                    Applies to creating, editing and moving the group's pages.
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
                    Delete group
                  </Button>
                )}
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!draft.name.trim() || save.isPending || uploading}
                  >
                    {save.isPending ? <Spinner /> : null}
                    Save changes
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
            <AlertDialogTitle>Delete {group.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All posts, comments and memberships of this group will be
              permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Group deleted")
                    onOpenChange(false)
                    void navigate(href("/groups"))
                  },
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              Delete group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
