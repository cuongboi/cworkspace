import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  LogOutIcon,
  UserPlusIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
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
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { useDbMutation } from "@/lib/query"
import type { GroupPrivacy } from "@app/api/zenstack/models"
import type { MyMembership } from "./group-query"

type GroupLike = {
  id: string
  name: string
  privacy: GroupPrivacy
  isDefault: boolean
}

/** Join (PUBLIC), request (CLOSED), cancel a request, or leave. */
export function useMembershipActions(group: GroupLike) {
  const { me } = useApp()
  const join = useDbMutation(
    () =>
      db.groupMember.create({
        data: {
          groupId: group.id,
          userId: me.id,
          status: group.privacy === "CLOSED" ? "PENDING" : "ACTIVE",
        },
      }),
    { invalidates: ["group", "groupMember", "post"] }
  )
  const leave = useDbMutation(
    () =>
      db.groupMember.delete({
        where: { groupId_userId: { groupId: group.id, userId: me.id } },
      }),
    { invalidates: ["group", "groupMember", "post"] }
  )
  return {
    join: () =>
      join.mutate(undefined, {
        onSuccess: () =>
          toast.success(
            group.privacy === "CLOSED"
              ? "Request sent to the group admins"
              : `You joined ${group.name}`
          ),
        onError: (err) => toast.error(err.message),
      }),
    leave: (message: string) =>
      leave.mutate(undefined, {
        onSuccess: () => toast.success(message),
        onError: (err) => toast.error(err.message),
      }),
    pending: join.isPending || leave.isPending,
  }
}

export function MembershipButton({
  group,
  membership,
  size = "default",
  className,
}: {
  group: GroupLike
  membership: MyMembership
  size?: "sm" | "default"
  className?: string
}) {
  const { join, leave, pending } = useMembershipActions(group)
  const [confirmLeave, setConfirmLeave] = useState(false)

  if (membership?.status === "ACTIVE") {
    if (group.isDefault) {
      return (
        <Button variant="secondary" size={size} className={className} disabled>
          <CheckIcon />
          Member
        </Button>
      )
    }
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size={size}
              className={className}
              disabled={pending}
            >
              <CheckIcon />
              Joined
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmLeave(true)}
            >
              <LogOutIcon />
              Leave group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave {group.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {group.privacy === "PUBLIC"
                  ? "You can join again at any time."
                  : group.privacy === "CLOSED"
                    ? "You'll need an admin's approval to join again."
                    : "You'll need to be added by an admin to join again."}
                {membership.role === "ADMIN"
                  ? " Make sure another member is an admin before you leave."
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => leave(`You left ${group.name}`)}
              >
                Leave group
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  if (membership?.status === "PENDING") {
    return (
      <Button
        variant="secondary"
        size={size}
        className={className}
        disabled={pending}
        onClick={() => leave("Request cancelled")}
        title="Cancel request"
      >
        {pending ? <Spinner /> : <ClockIcon />}
        Requested · Cancel
      </Button>
    )
  }

  if (group.privacy === "SECRET") return null

  return (
    <Button size={size} className={className} disabled={pending} onClick={join}>
      {pending ? <Spinner /> : <UserPlusIcon />}
      {group.privacy === "CLOSED" ? "Request to join" : "Join group"}
    </Button>
  )
}
