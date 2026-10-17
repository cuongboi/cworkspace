import { useNavigate } from "react-router-dom"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useOrg } from "@/hooks/use-org"
import { ApiError, db } from "@/lib/api-client"
import { useDbMutation } from "@/lib/query"
import { slugify } from "@/lib/slug"
import { GroupPrivacy } from "@app/api/zenstack/models"
import { PrivacyPicker } from "./privacy-picker"

type Draft = { name: string; description: string; privacy: GroupPrivacy }

export function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { org, me, href } = useOrg()
  const [draft, setDraft] = useState<Draft>({
    name: "",
    description: "",
    privacy: GroupPrivacy.PUBLIC,
  })

  const create = useDbMutation(
    async (d: Draft) => {
      const base = slugify(d.name) || "group"
      const attempt = (slug: string) =>
        db.group.create({
          data: {
            organizationId: org.id,
            name: d.name.trim(),
            slug,
            description: d.description.trim() || null,
            privacy: d.privacy,
            members: { create: { userId: me.id, role: "ADMIN" } },
          },
          select: { slug: true },
        })
      try {
        return await attempt(base)
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "CONFLICT")) throw err
        return attempt(
          `${base.slice(0, 42)}-${Math.random().toString(36).slice(2, 7)}`
        )
      }
    },
    { invalidates: ["group", "groupMember"] }
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim()) return
    create.mutate(draft, {
      onSuccess: (group) => {
        toast.success("Group created")
        // navigating away unmounts the dialog (and drops `?create=1`)
        setDraft({ name: "", description: "", privacy: GroupPrivacy.PUBLIC })
        void navigate(href(`/groups/${group.slug}`))
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Create a group</DialogTitle>
            <DialogDescription>
              Groups are where teams and communities share updates.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="group-name">Name</FieldLabel>
              <Input
                id="group-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Design team"
                maxLength={80}
                required
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="group-description">Description</FieldLabel>
              <Textarea
                id="group-description"
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
                placeholder="What is this group about?"
                rows={3}
                maxLength={1000}
              />
            </Field>
            <Field>
              <FieldLabel>Privacy</FieldLabel>
              <PrivacyPicker
                idPrefix="create-privacy"
                value={draft.privacy}
                onChange={(privacy) => setDraft({ ...draft, privacy })}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!draft.name.trim() || create.isPending}
            >
              {create.isPending ? <Spinner /> : null}
              Create group
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
