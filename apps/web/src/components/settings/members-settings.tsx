import { useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import {
  MoreHorizontalIcon,
  SearchIcon,
  ShieldIcon,
  UserMinusIcon,
  UsersIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useState } from "react"
import { toast } from "sonner"
import { UserAvatar } from "@/components/common/user-avatar"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
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
import { type OrgRole, useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { authClient } from "@/lib/auth-client"
import { invalidateModels, useDbQuery } from "@/lib/query"
import {
  asRole,
  errorMessage,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  unwrap,
} from "./settings-utils"

type PendingAction =
  | { kind: "role"; memberId: string; name: string; from: OrgRole; to: OrgRole }
  | { kind: "remove"; memberId: string; name: string }

export function MembersSettings() {
  const { org, me, role: myRole, href } = useOrg()
  const queryClient = useQueryClient()
  const [q, setQ] = useState("")
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: members, isPending } = useDbQuery(
    ["member", "findMany", "settings", org.id],
    () =>
      db.member.findMany({
        where: { organizationId: org.id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              title: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      })
  )

  const ownerCount = members?.filter((m) => m.role === "owner").length ?? 0
  const query = q.trim().toLowerCase()
  const visible = (members ?? []).filter(
    (m) =>
      !query ||
      m.user.name.toLowerCase().includes(query) ||
      m.user.email.toLowerCase().includes(query)
  )

  /** Roles I may assign to this member (empty: I can't change it). */
  const assignableRoles = (target: {
    userId: string
    role: string
  }): OrgRole[] => {
    if (target.userId === me.id) return []
    const role = asRole(target.role)
    if (role === "owner" && myRole !== "owner") return []
    if (role === "owner" && ownerCount <= 1) return []
    return myRole === "owner"
      ? ["member", "admin", "owner"]
      : ["member", "admin"]
  }
  const canRemove = (target: { userId: string; role: string }) => {
    if (target.userId === me.id) return false
    if (target.role === "owner") return myRole === "owner" && ownerCount > 1
    return true
  }

  const run = async () => {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === "role") {
        await unwrap(
          authClient.organization.updateMemberRole({
            organizationId: org.id,
            memberId: pending.memberId,
            role: pending.to,
          })
        )
        toast.success(
          `${pending.name} is now ${ROLE_LABELS[pending.to].toLowerCase()}`
        )
      } else {
        await unwrap(
          authClient.organization.removeMember({
            organizationId: org.id,
            memberIdOrEmail: pending.memberId,
          })
        )
        toast.success(`${pending.name} was removed`)
      }
      await invalidateModels(queryClient, ["member", "organization"])
      setPending(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {members
              ? `${members.length} ${members.length === 1 ? "person" : "people"} in ${org.name}`
              : "Loading…"}
          </CardDescription>
        </div>
        <InputGroup className="sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search members"
            aria-label="Search members"
          />
        </InputGroup>
      </CardHeader>
      <CardContent className="px-0">
        {isPending ? (
          <div className="flex flex-col gap-3 px-6">
            {Array.from({ length: 5 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No members found</EmptyTitle>
              <EmptyDescription>Nobody matches “{q}”.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead className="hidden md:table-cell">Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Joined</TableHead>
                <TableHead className="w-12 pr-6">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((m) => {
                const role = asRole(m.role)
                const roles = assignableRoles(m)
                const removable = canRemove(m)
                const isMe = m.userId === me.id
                return (
                  <TableRow key={m.id}>
                    <TableCell className="pl-6">
                      <Link
                        to={href(`/people/${m.user.id}`)}
                        className="flex min-w-0 items-center gap-3"
                      >
                        <UserAvatar user={m.user} size="sm" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium hover:underline">
                            {m.user.name}
                            {isMe ? (
                              <span className="ml-1 font-normal text-muted-foreground">
                                (you)
                              </span>
                            ) : null}
                          </span>
                          <span className="truncate text-xs text-muted-foreground md:hidden">
                            {m.user.email}
                          </span>
                          {m.user.title ? (
                            <span className="hidden truncate text-xs text-muted-foreground md:block">
                              {m.user.title}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {m.user.email}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          role === "member"
                            ? "outline"
                            : role === "owner"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {role !== "member" ? <ShieldIcon /> : null}
                        {ROLE_LABELS[role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {format(m.createdAt, "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {roles.length > 0 || removable ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Manage ${m.user.name}`}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-64">
                            {roles.length > 0 ? (
                              <>
                                <DropdownMenuLabel>Role</DropdownMenuLabel>
                                <DropdownMenuRadioGroup
                                  value={role}
                                  onValueChange={(to) => {
                                    if (to !== role)
                                      setPending({
                                        kind: "role",
                                        memberId: m.id,
                                        name: m.user.name,
                                        from: role,
                                        to: to as OrgRole,
                                      })
                                  }}
                                >
                                  {roles.map((r) => (
                                    <DropdownMenuRadioItem
                                      key={r}
                                      value={r}
                                      className="items-start"
                                    >
                                      <span className="flex flex-col">
                                        <span>{ROLE_LABELS[r]}</span>
                                        <span className="text-xs text-muted-foreground">
                                          {ROLE_DESCRIPTIONS[r]}
                                        </span>
                                      </span>
                                    </DropdownMenuRadioItem>
                                  ))}
                                </DropdownMenuRadioGroup>
                              </>
                            ) : null}
                            {roles.length > 0 && removable ? (
                              <DropdownMenuSeparator />
                            ) : null}
                            {removable ? (
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() =>
                                  setPending({
                                    kind: "remove",
                                    memberId: m.id,
                                    name: m.user.name,
                                  })
                                }
                              >
                                <UserMinusIcon />
                                Remove from organization
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(o) => !o && !busy && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "remove"
                ? `Remove ${pending.name}?`
                : pending
                  ? `Make ${pending.name} ${ROLE_LABELS[pending.to].toLowerCase()}?`
                  : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "remove"
                ? `${pending.name} will lose access to ${org.name}, its groups and chats. You can invite them again later.`
                : pending
                  ? `${ROLE_LABELS[pending.to]}s: ${ROLE_DESCRIPTIONS[pending.to].toLowerCase()}.`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={pending?.kind === "remove" ? "destructive" : "default"}
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                void run()
              }}
            >
              {busy ? <Spinner /> : null}
              {pending?.kind === "remove" ? "Remove" : "Change role"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
