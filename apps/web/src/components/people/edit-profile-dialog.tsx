import { CameraIcon } from "lucide-react"
import { type FormEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
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
import { useOrg } from "@/hooks/use-org"
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

type Draft = {
  name: string
  image: string | null
  title: string
  department: string
  location: string
  phone: string
  bio: string
}

const TEXT_FIELDS = [
  {
    key: "title",
    label: "Job title",
    placeholder: "e.g. Product designer",
    maxLength: 100,
  },
  {
    key: "department",
    label: "Department",
    placeholder: "e.g. Design",
    maxLength: 100,
  },
  {
    key: "location",
    label: "Location",
    placeholder: "e.g. Ho Chi Minh City",
    maxLength: 100,
  },
  { key: "phone", label: "Phone", placeholder: "+84 …", maxLength: 40 },
] as const

/** Edits my own profile (`db.user.update` on my row; email is immutable). Mount it only while open. */
export function EditProfileDialog({
  profile,
  onOpenChange,
}: {
  profile: EditableProfile
  onOpenChange: (open: boolean) => void
}) {
  const { org, me } = useOrg()
  const session = authClient.useSession()
  const [draft, setDraft] = useState<Draft>(() => ({
    name: profile.name,
    image: profile.image,
    title: profile.title ?? "",
    department: profile.department ?? "",
    location: profile.location ?? "",
    phone: profile.phone ?? "",
    bio: profile.bio ?? "",
  }))
  const [uploading, setUploading] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)

  const save = useDbMutation(
    (d: Draft) =>
      db.user.update({
        where: { id: me.id },
        data: {
          name: d.name.trim(),
          image: d.image,
          title: d.title.trim() || null,
          department: d.department.trim() || null,
          location: d.location.trim() || null,
          phone: d.phone.trim() || null,
          bio: d.bio.trim() || null,
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
      const attachment = await uploadFile(file, org.id, { orgVisible: true })
      setDraft((d) => ({ ...d, image: fileUrl(attachment.id) }))
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
        toast.success("Profile updated")
        // the sidebar reads name/avatar from the session
        void session.refetch()
        onOpenChange(false)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-lg">
        <ScrollArea
          className="rounded-[inherit]"
          viewportClassName="max-h-[90svh]"
        >
          <div className="grid gap-6 p-6">
            <form onSubmit={submit} className="flex flex-col gap-6">
              <DialogHeader>
                <DialogTitle>Edit profile</DialogTitle>
                <DialogDescription>
                  This is what your colleagues see in the directory.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-4">
                <UserAvatar
                  user={{ name: draft.name, image: draft.image }}
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
                    {draft.image ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft({ ...draft, image: null })}
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
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profile-name">Full name</FieldLabel>
                  <Input
                    id="profile-name"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                    maxLength={100}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="profile-email">Email</FieldLabel>
                  <Input
                    id="profile-email"
                    value={profile.email}
                    disabled
                    readOnly
                  />
                  <FieldDescription>
                    Your sign-in email can't be changed here.
                  </FieldDescription>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  {TEXT_FIELDS.map((f) => (
                    <Field key={f.key}>
                      <FieldLabel htmlFor={`profile-${f.key}`}>
                        {f.label}
                      </FieldLabel>
                      <Input
                        id={`profile-${f.key}`}
                        value={draft[f.key]}
                        onChange={(e) =>
                          setDraft({ ...draft, [f.key]: e.target.value })
                        }
                        placeholder={f.placeholder}
                        maxLength={f.maxLength}
                        type={f.key === "phone" ? "tel" : "text"}
                      />
                    </Field>
                  ))}
                </div>
                <Field>
                  <FieldLabel htmlFor="profile-bio">Bio</FieldLabel>
                  <Textarea
                    id="profile-bio"
                    value={draft.bio}
                    onChange={(e) =>
                      setDraft({ ...draft, bio: e.target.value })
                    }
                    placeholder="A few words about you and your work"
                    rows={4}
                    maxLength={1000}
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
                  disabled={!draft.name.trim() || save.isPending || uploading}
                >
                  {save.isPending ? <Spinner /> : null}
                  Save
                </Button>
              </DialogFooter>
            </form>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
