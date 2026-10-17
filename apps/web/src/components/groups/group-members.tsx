import {
  CheckIcon,
  MoreHorizontalIcon,
  SearchIcon,
  ShieldIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useState } from "react"
import { toast } from "sonner"
import { UserAvatar } from "@/components/common/user-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { useDbMutation, useDbQuery } from "@/lib/query"
import {
  type GroupRole,
  GroupRole as GroupRoles,
} from "@app/api/zenstack/models"
import type { GroupWithMe } from "./group-query"

const ROLE_LABEL: Record<GroupRole, string> = {
  ADMIN: "Admin",
  MODERATOR: "Moderator",
  MEMBER: "Member",
}

/** Members tab: pending requests (for admins), member list with role management. */
export function GroupMembers({ group }: { group: GroupWithMe }) {
  const { me, isAdmin: orgAdmin, href } = useOrg()
  const myRole =
    group.members[0]?.status === "ACTIVE" ? group.members[0].role : undefined
  // policies: group ADMIN or org admin update rows (approve, roles); ADMIN/MODERATOR/org admin remove
  const canManageRoles = orgAdmin || myRole === "ADMIN"
  const canRemove = orgAdmin || myRole === "ADMIN" || myRole === "MODERATOR"
  const canAdd = myRole === "ADMIN" || myRole === "MODERATOR"
  const [filter, setFilter] = useState("")
  const [adding, setAdding] = useState(false)

  const { data: rows, isPending } = useDbQuery(
    ["groupMember", "findMany", "group", group.id],
    () =>
      db.groupMember.findMany({
        where: { groupId: group.id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
              title: true,
              department: true,
            },
          },
        },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        take: 100,
      })
  )

  const update = useDbMutation(
    (vars: { userId: string; data: { role?: GroupRole; status?: "ACTIVE" } }) =>
      db.groupMember.update({
        where: { groupId_userId: { groupId: group.id, userId: vars.userId } },
        data: vars.data,
      }),
    { invalidates: ["groupMember", "group"] }
  )
  const remove = useDbMutation(
    (userId: string) =>
      db.groupMember.delete({
        where: { groupId_userId: { groupId: group.id, userId } },
      }),
    { invalidates: ["groupMember", "group"] }
  )

  const onError = (err: Error) => toast.error(err.message)
  const pending = (rows ?? []).filter((r) => r.status === "PENDING")
  const q = filter.trim().toLowerCase()
  const active = (rows ?? []).filter(
    (r) =>
      r.status === "ACTIVE" &&
      (!q ||
        r.user.name.toLowerCase().includes(q) ||
        r.user.title?.toLowerCase().includes(q))
  )

  return (
    <div className="flex flex-col gap-4">
      {canRemove && pending.length > 0 ? (
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle>Membership requests · {pending.length}</CardTitle>
          </CardHeader>
          <CardContent className="px-2">
            <ItemGroup>
              {pending.map((r) => (
                <Item key={r.id} size="sm">
                  <ItemMedia>
                    <UserAvatar user={r.user} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      <Link
                        to={href(`/people/${r.user.id}`)}
                        className="hover:underline"
                      >
                        {r.user.name}
                      </Link>
                    </ItemTitle>
                    <ItemDescription>
                      {r.user.title || "Wants to join"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {canManageRoles ? (
                      <Button
                        size="sm"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate(
                            { userId: r.userId, data: { status: "ACTIVE" } },
                            {
                              onSuccess: () =>
                                toast.success(`${r.user.name} approved`),
                              onError,
                            }
                          )
                        }
                      >
                        <CheckIcon />
                        Approve
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(r.userId, { onError })}
                    >
                      <XIcon />
                      Decline
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      ) : null}

      <Card className="gap-3 py-4">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-4">
          <CardTitle>Members · {group._count.members}</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find a member"
                aria-label="Find a member"
                className="h-8 w-44 pl-8"
              />
            </div>
            {canAdd && !group.isDefault ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                <UserPlusIcon />
                Add
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-2">
          {isPending ? (
            <div className="flex flex-col gap-3 px-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          ) : active.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No members match "{filter}".
            </p>
          ) : (
            <ItemGroup>
              {active.map((r) => {
                const isMe = r.userId === me.id
                // moderators can't remove admins
                const removable =
                  !isMe &&
                  !group.isDefault &&
                  canRemove &&
                  (canManageRoles || r.role !== "ADMIN")
                return (
                  <Item key={r.id} size="sm">
                    <ItemMedia>
                      <UserAvatar user={r.user} presence />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        <Link
                          to={href(`/people/${r.user.id}`)}
                          className="hover:underline"
                        >
                          {r.user.name}
                        </Link>
                        {isMe ? (
                          <span className="font-normal text-muted-foreground">
                            (you)
                          </span>
                        ) : null}
                        {r.role !== "MEMBER" ? (
                          <Badge
                            variant={
                              r.role === "ADMIN" ? "default" : "secondary"
                            }
                          >
                            <ShieldIcon />
                            {ROLE_LABEL[r.role]}
                          </Badge>
                        ) : null}
                      </ItemTitle>
                      {r.user.title || r.user.department ? (
                        <ItemDescription>
                          {[r.user.title, r.user.department]
                            .filter(Boolean)
                            .join(" · ")}
                        </ItemDescription>
                      ) : null}
                    </ItemContent>
                    {canManageRoles || removable ? (
                      <ItemActions>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Manage ${r.user.name}`}
                            >
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44">
                            {canManageRoles ? (
                              <>
                                <DropdownMenuLabel>Role</DropdownMenuLabel>
                                <DropdownMenuRadioGroup
                                  value={r.role}
                                  onValueChange={(role) =>
                                    update.mutate(
                                      {
                                        userId: r.userId,
                                        data: { role: role as GroupRole },
                                      },
                                      {
                                        onSuccess: () =>
                                          toast.success(
                                            `${r.user.name} is now ${ROLE_LABEL[role as GroupRole].toLowerCase()}`
                                          ),
                                        onError,
                                      }
                                    )
                                  }
                                >
                                  {Object.values(GroupRoles).map((role) => (
                                    <DropdownMenuRadioItem
                                      key={role}
                                      value={role}
                                    >
                                      {ROLE_LABEL[role]}
                                    </DropdownMenuRadioItem>
                                  ))}
                                </DropdownMenuRadioGroup>
                              </>
                            ) : null}
                            {removable ? (
                              <>
                                {canManageRoles ? (
                                  <DropdownMenuSeparator />
                                ) : null}
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() =>
                                    remove.mutate(r.userId, {
                                      onSuccess: () =>
                                        toast.success(
                                          `${r.user.name} removed from the group`
                                        ),
                                      onError,
                                    })
                                  }
                                >
                                  Remove from group
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ItemActions>
                    ) : null}
                  </Item>
                )
              })}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <AddMembersDialog
        open={adding}
        onOpenChange={setAdding}
        groupId={group.id}
        existing={new Set((rows ?? []).map((r) => r.userId))}
      />
    </div>
  )
}

function AddMembersDialog({
  open,
  onOpenChange,
  groupId,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  existing: Set<string>
}) {
  const { org } = useOrg()
  const [q, setQ] = useState("")
  const { data: people = [], isPending } = useDbQuery(
    ["user", "findMany", "group-add", org.id, q.trim()],
    () =>
      db.user.findMany({
        where: {
          members: { some: { organizationId: org.id } },
          ...(q.trim()
            ? { name: { contains: q.trim(), mode: "insensitive" } }
            : {}),
        },
        select: { id: true, name: true, image: true, title: true },
        orderBy: { name: "asc" },
        take: 30,
      }),
    { enabled: open }
  )
  const add = useDbMutation(
    (userId: string) =>
      db.groupMember.create({ data: { groupId, userId, status: "ACTIVE" } }),
    { invalidates: ["groupMember", "group"] }
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add members</DialogTitle>
          <DialogDescription>People you add join right away.</DialogDescription>
        </DialogHeader>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          autoFocus
        />
        <div className="-mx-2 max-h-80 overflow-y-auto">
          {isPending ? (
            <div className="flex justify-center p-4">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <ItemGroup>
              {people.map((p) => {
                const member = existing.has(p.id)
                return (
                  <Item key={p.id} size="xs">
                    <ItemMedia>
                      <UserAvatar user={p} size="sm" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{p.name}</ItemTitle>
                      {p.title ? (
                        <ItemDescription>{p.title}</ItemDescription>
                      ) : null}
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="xs"
                        variant={member ? "ghost" : "outline"}
                        disabled={member || add.isPending}
                        onClick={() =>
                          add.mutate(p.id, {
                            onSuccess: () => toast.success(`${p.name} added`),
                            onError: (err) => toast.error(err.message),
                          })
                        }
                      >
                        {member ? "Member" : "Add"}
                      </Button>
                    </ItemActions>
                  </Item>
                )
              })}
              {people.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No one found.
                </p>
              ) : null}
            </ItemGroup>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
