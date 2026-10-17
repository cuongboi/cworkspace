import { useQueryClient } from "@tanstack/react-query"
import {
  CopyIcon,
  ImageUpIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { initials } from "@/components/common/user-avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { useOrg } from "@/hooks/use-org"
import { authClient } from "@/lib/auth-client"
import { invalidateModels } from "@/lib/query"
import { fileUrl, uploadFile } from "@/lib/upload"
import { errorMessage, unwrap } from "./settings-utils"

export function GeneralSettings() {
  const { org, role } = useOrg()
  const queryClient = useQueryClient()
  const [name, setName] = useState(org.name)
  const [logo, setLogo] = useState<string | null>(org.logo ?? null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const trimmed = name.trim()
  const nameError = trimmed
    ? trimmed.length > 100
      ? "Keep it under 100 characters"
      : null
    : "Name is required"
  const dirty = trimmed !== org.name || (logo ?? null) !== (org.logo ?? null)

  const pickLogo = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/"))
      return void toast.error("Choose an image file")
    setUploading(true)
    try {
      const attachment = await uploadFile(file, org.id, { orgVisible: true })
      setLogo(fileUrl(attachment.id))
    } catch (err) {
      toast.error(errorMessage(err, "Upload failed"))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const save = async () => {
    if (nameError) return
    setSaving(true)
    try {
      await unwrap(
        authClient.organization.update({
          organizationId: org.id,
          data: { name: trimmed, logo: logo ?? "" },
        })
      )
      await invalidateModels(queryClient, ["organization"])
      toast.success("Organization updated")
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't update the organization"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization profile</CardTitle>
          <CardDescription>
            How your organization appears to its members.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="org-general"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel>Logo</FieldLabel>
                <div className="flex items-center gap-4">
                  <Avatar className="size-16 rounded-xl after:rounded-xl">
                    {logo ? (
                      <AvatarImage src={logo} alt="" className="rounded-xl" />
                    ) : null}
                    <AvatarFallback className="rounded-xl text-lg">
                      {initials(trimmed || org.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden
                      onChange={(e) => void pickLogo(e.target.files?.[0])}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInput.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? <Spinner /> : <ImageUpIcon />}
                      {logo ? "Change logo" : "Upload logo"}
                    </Button>
                    {logo ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLogo(null)}
                        disabled={uploading}
                      >
                        <Trash2Icon />
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
                <FieldDescription>A square image works best.</FieldDescription>
              </Field>
              <Field data-invalid={Boolean(nameError)}>
                <FieldLabel htmlFor="org-name">Name</FieldLabel>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={Boolean(nameError)}
                  maxLength={120}
                />
                {nameError ? <FieldError>{nameError}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="org-slug">URL</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>/</InputGroupAddon>
                  <InputGroupInput id="org-slug" value={org.slug} readOnly />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="Copy link"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(`${window.location.origin}/${org.slug}`)
                          .then(() => toast.success("Link copied"))
                      }}
                    >
                      <CopyIcon />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  The organization's address can't be changed.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t">
          <Button
            type="button"
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => {
              setName(org.name)
              setLogo(org.logo ?? null)
            }}
          >
            Reset
          </Button>
          <Button
            type="submit"
            form="org-general"
            disabled={!dirty || Boolean(nameError) || saving || uploading}
          >
            {saving ? <Spinner /> : null}
            Save changes
          </Button>
        </CardFooter>
      </Card>

      {role === "owner" ? <DangerZone /> : null}
    </div>
  )
}

function DangerZone() {
  const { org } = useOrg()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const matches = confirm.trim() === org.name

  const remove = async () => {
    if (!matches) return
    setBusy(true)
    try {
      await unwrap(authClient.organization.delete({ organizationId: org.id }))
      toast.success(`${org.name} was deleted`)
      await navigate("/", { replace: true })
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't delete the organization"))
      setBusy(false)
    }
  }

  return (
    <Card className="border-destructive/40 ring-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Deleting the organization permanently removes its groups, posts,
          chats, events and files for everyone.
        </CardDescription>
      </CardHeader>
      <CardFooter className="justify-end">
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2Icon />
          Delete organization
        </Button>
      </CardFooter>
      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setConfirm("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <TriangleAlertIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete {org.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. All members lose access immediately. Type{" "}
              <strong>{org.name}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={org.name}
            aria-label="Organization name"
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!matches || busy}
              onClick={(e) => {
                e.preventDefault()
                void remove()
              }}
            >
              {busy ? <Spinner /> : null}
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
