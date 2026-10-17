import { useQueryClient } from "@tanstack/react-query"
import { format, isPast } from "date-fns"
import { CopyIcon, MailIcon, MailPlusIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { TimeAgo } from "@/components/common/time-ago"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api, db } from "@/lib/api-client"
import { COMPANY_NAME } from "@/lib/company"
import { invalidateModels, useDbQuery } from "@/lib/query"
import {
  asRole,
  errorMessage,
  type InstanceRole,
  ROLE_LABELS,
} from "./settings-utils"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseEmails(input: string) {
  const all = input
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const unique = [...new Set(all)]
  return {
    valid: unique.filter((e) => EMAIL_RE.test(e)),
    invalid: unique.filter((e) => !EMAIL_RE.test(e)),
  }
}

export function InvitationsSettings() {
  const queryClient = useQueryClient()
  const [emails, setEmails] = useState("")
  const [role, setRole] = useState<InstanceRole>("user")
  const [submitted, setSubmitted] = useState(false)
  const [sending, setSending] = useState(false)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const { data: invitations, isPending } = useDbQuery(
    ["invitation", "findMany", "settings"],
    () =>
      db.invitation.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      })
  )

  const { valid, invalid } = parseEmails(emails)
  const formError =
    invalid.length > 0
      ? `Not a valid email: ${invalid.join(", ")}`
      : valid.length === 0
        ? "Enter at least one email address"
        : null

  const send = async () => {
    setSubmitted(true)
    if (formError) return
    setSending(true)
    const failed: string[] = []
    let sent = 0
    for (const email of valid) {
      try {
        await api.post("/api/invitations", { email, role })
        sent++
      } catch (err) {
        failed.push(email)
        toast.error(`${email}: ${errorMessage(err, "couldn't invite")}`)
      }
    }
    await invalidateModels(queryClient, ["invitation"])
    setSending(false)
    if (sent > 0)
      toast.success(sent === 1 ? "Invitation sent" : `${sent} invitations sent`)
    setEmails(failed.join(", "))
    setSubmitted(false)
  }

  const cancel = async () => {
    if (!cancelId) return
    setCancelling(true)
    try {
      await api.post(`/api/invitations/${cancelId}/cancel`)
      await invalidateModels(queryClient, ["invitation"])
      toast.success("Invitation cancelled")
      setCancelId(null)
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't cancel the invitation"))
    } finally {
      setCancelling(false)
    }
  }

  const copyLink = (id: string) => {
    void navigator.clipboard
      .writeText(`${window.location.origin}/invite/${id}`)
      .then(() => toast.success("Invite link copied"))
      .catch(() => toast.error("Couldn't copy the link"))
  }

  const sorted = [...(invitations ?? [])].sort(
    (a, b) =>
      Number(b.status === "PENDING") - Number(a.status === "PENDING") ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  const cancelTarget = sorted.find((i) => i.id === cancelId)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Invite people</CardTitle>
          <CardDescription>
            We'll email them a link to join {COMPANY_NAME}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <Field data-invalid={submitted && Boolean(formError)}>
              <FieldLabel htmlFor="invite-emails">Email addresses</FieldLabel>
              <Textarea
                id="invite-emails"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="alice@example.com, bob@example.com"
                rows={2}
                aria-invalid={submitted && Boolean(formError)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              {submitted && formError ? (
                <FieldError>{formError}</FieldError>
              ) : (
                <FieldDescription>
                  Separate several addresses with commas.
                </FieldDescription>
              )}
            </Field>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Field className="w-fit">
                <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                <NativeSelect
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(asRole(e.target.value))}
                >
                  <NativeSelectOption value="user">
                    {ROLE_LABELS.user}
                  </NativeSelectOption>
                  <NativeSelectOption value="admin">
                    {ROLE_LABELS.admin}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <Button type="submit" disabled={sending}>
                {sending ? <Spinner /> : <MailPlusIcon />}
                {valid.length > 1
                  ? `Send ${valid.length} invitations`
                  : "Send invitation"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>
            Pending invitations expire after a while; you can resend them by
            inviting again.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {isPending ? (
            <div className="flex flex-col gap-3 px-6">
              {Array.from({ length: 3 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MailIcon />
                </EmptyMedia>
                <EmptyTitle>No invitations yet</EmptyTitle>
                <EmptyDescription>
                  Invite your teammates with the form above.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Email</TableHead>
                  <TableHead className="hidden sm:table-cell">Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Sent</TableHead>
                  <TableHead className="pr-6 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((inv) => {
                  const expiresAt = new Date(inv.expiresAt)
                  const status = inv.status.toLowerCase()
                  const expired = status === "pending" && isPast(expiresAt)
                  const isPendingInvite = status === "pending" && !expired
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="max-w-48 truncate pl-6 font-medium sm:max-w-none">
                        {inv.email}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {ROLE_LABELS[asRole(inv.role)]}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <StatusBadge status={expired ? "expired" : status} />
                          {isPendingInvite ? (
                            <span className="text-xs text-muted-foreground">
                              Expires {format(expiresAt, "MMM d, p")}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        <TimeAgo date={inv.createdAt} />
                      </TableCell>
                      <TableCell className="pr-6">
                        {isPendingInvite ? (
                          <div className="flex justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => copyLink(inv.id)}
                                  aria-label={`Copy invite link for ${inv.email}`}
                                >
                                  <CopyIcon />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy link</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => setCancelId(inv.id)}
                                  aria-label={`Cancel invitation for ${inv.email}`}
                                >
                                  <XIcon />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Cancel</TooltipContent>
                            </Tooltip>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={cancelId !== null}
        onOpenChange={(o) => !o && !cancelling && setCancelId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget
                ? `${cancelTarget.email} won't be able to join with the link they received.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelling}
              onClick={(e) => {
                e.preventDefault()
                void cancel()
              }}
            >
              {cancelling ? <Spinner /> : null}
              Cancel invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary">Pending</Badge>
    case "accepted":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
        >
          Accepted
        </Badge>
      )
    case "expired":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Expired
        </Badge>
      )
    case "canceled":
    case "cancelled":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          Cancelled
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}
