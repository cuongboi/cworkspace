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
import { useTranslation } from "react-i18next"
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
import { useDateLocale } from "@/lib/i18n"
import { invalidateModels, useDbQuery } from "@/lib/query"
import {
  asRole,
  errorMessage,
  type InstanceRole,
  roleDescription,
  roleLabel,
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

export function MembersSettings() {
  const { t } = useTranslation()
  const locale = useDateLocale()
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
            t("settings.members.roleChanged", {
              name: pending.name,
              role: roleLabel(pending.to),
            })
          )
          break
        case "ban":
          await unwrap(authClient.admin.banUser({ userId }))
          toast.success(
            t("settings.members.deactivatedToast", { name: pending.name })
          )
          break
        case "unban":
          await unwrap(authClient.admin.unbanUser({ userId }))
          toast.success(
            t("settings.members.reactivatedToast", { name: pending.name })
          )
          break
        case "remove":
          await unwrap(authClient.admin.removeUser({ userId }))
          toast.success(
            t("settings.members.deletedToast", { name: pending.name })
          )
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
          <CardTitle>{t("settings.members.title")}</CardTitle>
          <CardDescription>
            {members
              ? t("settings.members.count", {
                  count: members.length,
                  company: COMPANY_NAME,
                })
              : t("common.loading")}
          </CardDescription>
        </div>
        <InputGroup className="sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("settings.members.search")}
            aria-label={t("settings.members.search")}
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
              <EmptyTitle>{t("settings.members.none")}</EmptyTitle>
              <EmptyDescription>
                {t("settings.members.noMatch", { q })}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">
                  {t("settings.members.name")}
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  {t("settings.members.email")}
                </TableHead>
                <TableHead>{t("settings.members.role")}</TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t("settings.members.joined")}
                </TableHead>
                <TableHead className="w-12 pr-6">
                  <span className="sr-only">
                    {t("settings.members.actions")}
                  </span>
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
                                {t("settings.members.you")}
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
                        {roleLabel(role)}
                      </Badge>
                      {m.banned ? (
                        <Badge variant="destructive" className="ml-1">
                          {t("settings.members.deactivated")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {format(m.createdAt, "PP", { locale })}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {!isMe ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("settings.members.manage", {
                                name: m.name,
                              })}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-64">
                            <DropdownMenuLabel>
                              {t("settings.members.role")}
                            </DropdownMenuLabel>
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
                                    <span>{roleLabel(r)}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {roleDescription(r)}
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
                              {m.banned
                                ? t("settings.members.reactivate")
                                : t("settings.members.deactivate")}
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
                              {t("settings.members.deleteAccount")}
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
                ? t("settings.members.confirmRole", {
                    name: pending.name,
                    role: roleLabel(pending.to),
                  })
                : pending?.kind === "ban"
                  ? t("settings.members.confirmDeactivate", {
                      name: pending.name,
                    })
                  : pending?.kind === "unban"
                    ? t("settings.members.confirmReactivate", {
                        name: pending.name,
                      })
                    : pending
                      ? t("settings.members.confirmDelete", {
                          name: pending.name,
                        })
                      : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "role"
                ? t("settings.members.roleBody", {
                    role: roleLabel(pending.to),
                    description: roleDescription(pending.to),
                  })
                : pending?.kind === "ban"
                  ? t("settings.members.banBody", { name: pending.name })
                  : pending?.kind === "unban"
                    ? t("settings.members.unbanBody", { name: pending.name })
                    : pending
                      ? t("settings.members.removeBody", { name: pending.name })
                      : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t("common.cancel")}
            </AlertDialogCancel>
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
                ? t("settings.members.changeRole")
                : pending?.kind === "ban"
                  ? t("settings.members.deactivate")
                  : pending?.kind === "unban"
                    ? t("settings.members.reactivate")
                    : pending
                      ? t("settings.members.delete")
                      : null}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
