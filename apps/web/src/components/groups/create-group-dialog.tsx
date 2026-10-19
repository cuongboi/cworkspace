import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"
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
import { ApiError, db } from "@/lib/api-client"
import { useDbMutation } from "@/lib/query"
import { slugify } from "@/lib/slug"
import { GroupPrivacy } from "@app/api/zenstack/models"
import { PrivacyPicker } from "./privacy-picker"

const shape = {
  name: z.string().trim().min(1, "Enter a group name").max(80),
  description: z.string().trim().max(1000),
  privacy: z.enum(GroupPrivacy).default(GroupPrivacy.PUBLIC),
}
type Draft = z.infer<z.ZodObject<typeof shape>>

const schema: AutoFormSchema<typeof shape> = {
  name: {
    schema: shape.name,
    as: Input,
    placeholder: "e.g. Design team",
    meta: { autoFocus: true },
  },
  description: {
    schema: shape.description,
    as: Textarea,
    placeholder: "What is this group about?",
    meta: { rows: 3 },
  },
  privacy: {
    schema: shape.privacy,
    render: ({ field }) => (
      <PrivacyPicker
        idPrefix="create-privacy"
        value={field.value as GroupPrivacy}
        onChange={field.onChange}
        disabled={field.disabled}
      />
    ),
  },
}

export function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { me } = useApp()
  const create = useDbMutation(
    async (d: Draft) => {
      const base = slugify(d.name) || "group"
      const attempt = (slug: string) =>
        db.group.create({
          data: {
            name: d.name,
            slug,
            description: d.description || null,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a group</DialogTitle>
          <DialogDescription>
            Groups are where teams and communities share updates.
          </DialogDescription>
        </DialogHeader>
        <AutoForm
          schema={schema}
          className="flex flex-col gap-6"
          onSubmit={(draft, form) =>
            create.mutate(draft, {
              onSuccess: (group) => {
                toast.success("Group created")
                // navigating away unmounts the dialog (and drops `?create=1`)
                form.reset()
                void navigate(`/groups/${group.slug}`)
              },
              onError: (err) => toast.error(err.message),
            })
          }
        >
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : null}
              Create group
            </Button>
          </DialogFooter>
        </AutoForm>
      </DialogContent>
    </Dialog>
  )
}
