import { CameraIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"
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
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string(),
  title: optionalText(100),
  department: optionalText(100),
  location: optionalText(100),
  phone: optionalText(40),
  bio: optionalText(1000),
}
type Draft = z.infer<z.ZodObject<typeof shape>>

const FULL_WIDTH = { container: "sm:col-span-2" }

const schema: AutoFormSchema<typeof shape> = {
  name: {
    schema: shape.name,
    label: "Full name",
    as: Input,
    classNames: FULL_WIDTH,
  },
  email: {
    schema: shape.email,
    as: Input,
    disabled: true,
    description: "Your sign-in email can't be changed here.",
    classNames: FULL_WIDTH,
  },
  title: {
    schema: shape.title,
    label: "Job title",
    as: Input,
    placeholder: "e.g. Product designer",
  },
  department: {
    schema: shape.department,
    as: Input,
    placeholder: "e.g. Design",
  },
  location: {
    schema: shape.location,
    as: Input,
    placeholder: "e.g. Ho Chi Minh City",
  },
  phone: {
    schema: shape.phone,
    as: Input,
    placeholder: "+84 …",
    meta: { type: "tel" },
  },
  bio: {
    schema: shape.bio,
    as: Textarea,
    placeholder: "A few words about you and your work",
    meta: { rows: 4 },
    classNames: FULL_WIDTH,
  },
}

/** Edits my own profile (`db.user.update` on my row; email is immutable). Mount it only while open. */
export function EditProfileDialog({
  profile,
  onOpenChange,
}: {
  profile: EditableProfile
  onOpenChange: (open: boolean) => void
}) {
  const { me } = useApp()
  const session = authClient.useSession()
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
      toast.error("Choose an image")
      return
    }
    setUploading(true)
    try {
      const attachment = await uploadFile(file, { isPublic: true })
      setImage(fileUrl(attachment.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const submit = (draft: Draft) =>
    save.mutate(draft, {
      onSuccess: () => {
        toast.success("Profile updated")
        // the sidebar reads name/avatar from the session
        void session.refetch()
        onOpenChange(false)
      },
      onError: (err) => toast.error(err.message),
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
              <DialogTitle>Edit profile</DialogTitle>
              <DialogDescription>
                This is what your colleagues see in the directory.
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
                            Change photo
                          </Button>
                          {image ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setImage(null)}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          PNG, JPG or WebP.
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
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending || uploading}>
                  {save.isPending ? <Spinner /> : null}
                  Save
                </Button>
              </DialogFooter>
            </AutoForm>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
