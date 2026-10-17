import { useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import {
  BanIcon,
  MoreHorizontalIcon,
  SearchIcon,
  ShieldIcon,
  UserCheckIcon,
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
import { useApp } from "@/hooks/use-app"
import { COMPANY_NAME } from "@/lib/company"
import { db } from "@/lib/api-client"
import { authClient } from "@/lib/auth-client"
import { invalidateModels, useDbQuery } from "@/lib/query"
import {
  asRole,
  errorMessage,
  type InstanceRole,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  unwrap,
} from "./settings-utils"

type PendingAction =
  | {
      kind: "role"
      userId: string
      name: string
      from: InstanceRole
      to: InstanceRole
    }
  | { kind: "ban" | "unban" | "remove"; userId: string; name: string }

const CONFIRM: Record<Exclude<PendingAction["kind"], "role">, string> = {
  ban: "Deactivate",
  unban: "Reactivate",
  remove: "Delete",
}

export function MembersSettings() {
  const { me } = useApp()
  const queryClient = useQueryClient()
  const [q, setQ] = useState("")
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: members, isPending } = useDbQuery(
    ["user", "findMany", "settings"],
    () =>
      db.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          title: true,
          role: true,
          banned: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      })
  )

  const query = q.trim().toLowerCase()
  const visible = (members ?? []).filter(
    (m) =>
      !query ||
      m.name.toLowerCase().includes(query) ||
      m.email.toLowerCase().includes(query)
  )

  // better-auth's admin endpoints check the caller's role server-side; never act on yourself
  const run = async () => {
    if (!pending) return
    setBusy(true)
    const { userId } = pending
    try {
      switch (pending.kind) {
        case "role":
          await unwrap(authClient.admin.setRole({ userId, role: pending.to }))
          toast.success(
            `${pending.name} is now ${ROLE_LABELS[pending.to].toLowerCase()}`
          )
          break
        case "ban":
          await unwrap(authClient.admin.banUser({ userId }))
          toast.success(`${pending.name} was deactivated`)
          break
        case "unban":
          await unwrap(authClient.admin.unbanUser({ userId }))
          toast.success(`${pending.name} was reactivated`)
          break
        case "remove":
          await unwrap(authClient.admin.removeUser({ userId }))
          toast.success(`${pending.name} was deleted`)
          break
      }
      await invalidateModels(queryClient, ["user"])
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
              ? `${members.length} ${members.length === 1 ? "person" : "people"} in ${COMPANY_NAME}`
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
                const isMe = m.id === me.id
                return (
                  <TableRow key={m.id}>
                    <TableCell className="pl-6">
                      <Link
                        to={`/people/${m.id}`}
                        className="flex min-w-0 items-center gap-3"
                      >
                        <UserAvatar user={m} size="sm" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium hover:underline">
                            {m.name}
                            {isMe ? (
                              <span className="ml-1 font-normal text-muted-foreground">
                                (you)
                              </span>
                            ) : null}
                          </span>
                          <span className="truncate text-xs text-muted-foreground md:hidden">
                            {m.email}
                          </span>
                          {m.title ? (
                            <span className="hidden truncate text-xs text-muted-foreground md:block">
                              {m.title}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {m.email}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={role === "admin" ? "secondary" : "outline"}
                      >
                        {role === "admin" ? <ShieldIcon /> : null}
                        {ROLE_LABELS[role]}
                      </Badge>
                      {m.banned ? (
                        <Badge variant="destructive" className="ml-1">
                          Deactivated
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {format(m.createdAt, "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {!isMe ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Manage ${m.name}`}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuLabel>Role</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={role}
                              onValueChange={(to) => {
                                if (to !== role)
                                  setPending({
                                    kind: "role",
                                    userId: m.id,
                                    name: m.name,
                                    from: role,
                                    to: to as InstanceRole,
                                  })
                              }}
                            >
                              {(["user", "admin"] as const).map((r) => (
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
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                setPending({
                                  kind: m.banned ? "unban" : "ban",
                                  userId: m.id,
                                  name: m.name,
                                })
                              }
                            >
                              {m.banned ? <UserCheckIcon /> : <BanIcon />}
                              {m.banned ? "Reactivate" : "Deactivate"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                setPending({
                                  kind: "remove",
                                  userId: m.id,
                                  name: m.name,
                                })
                              }
                            >
                              <UserMinusIcon />
                              Delete account
                            </DropdownMenuItem>
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
              {pending?.kind === "role"
                ? `Make ${pending.name} ${ROLE_LABELS[pending.to].toLowerCase()}?`
                : pending
                  ? `${CONFIRM[pending.kind]} ${pending.name}?`
                  : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "role"
                ? `${ROLE_LABELS[pending.to]}s: ${ROLE_DESCRIPTIONS[pending.to].toLowerCase()}.`
                : pending?.kind === "ban"
                  ? `${pending.name} is signed out and can't sign in until reactivated.`
                  : pending?.kind === "unban"
                    ? `${pending.name} can sign in again.`
                    : pending
                      ? `Permanently deletes ${pending.name}'s account with their posts, messages and the groups they created. Deactivate instead to keep their content.`
                      : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={
                pending?.kind === "remove" || pending?.kind === "ban"
                  ? "destructive"
                  : "default"
              }
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                void run()
              }}
            >
              {busy ? <Spinner /> : null}
              {pending?.kind === "role"
                ? "Change role"
                : pending
                  ? CONFIRM[pending.kind]
                  : null}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
