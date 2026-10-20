import { cn } from "cn"
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  LogOutIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
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
import { errorMessage } from "@/lib/i18n"
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
  const { t } = useTranslation()
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
              ? t("groups.requestSent")
              : t("groups.joinedToast", { name: group.name })
          ),
        onError: (err) => toast.error(errorMessage(err)),
      }),
    leave: (message: string) =>
      leave.mutate(undefined, {
        onSuccess: () => toast.success(message),
        onError: (err) => toast.error(errorMessage(err)),
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
  const { t } = useTranslation()
  const { join, leave, pending } = useMembershipActions(group)
  const [confirmLeave, setConfirmLeave] = useState(false)

  if (membership?.status === "ACTIVE") {
    if (group.isDefault) {
      return (
        <Button variant="secondary" size={size} className={className} disabled>
          <CheckIcon />
          {t("groups.member")}
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
              {t("groups.joined")}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmLeave(true)}
            >
              <LogOutIcon />
              {t("groups.leave")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("groups.leaveTitle", { name: group.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {group.privacy === "PUBLIC"
                  ? t("groups.leavePublic")
                  : group.privacy === "CLOSED"
                    ? t("groups.leaveClosed")
                    : t("groups.leaveSecret")}
                {membership.role === "ADMIN" ? t("groups.leaveAdmin") : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  leave(t("groups.leftToast", { name: group.name }))
                }
              >
                {t("groups.leave")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  if (membership?.status === "PENDING") {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size={size}
              className={cn("text-warning", className)}
              disabled={pending}
            >
              {pending ? <Spinner /> : <ClockIcon />}
              {t("groups.requested")}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmLeave(true)}
            >
              <XIcon />
              {t("groups.cancelRequest")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("groups.cancelRequestTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("groups.cancelRequestBody", { name: group.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("groups.keepRequest")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => leave(t("groups.requestCancelled"))}
              >
                {t("groups.cancelRequest")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  if (group.privacy === "SECRET") return null

  return (
    <Button
      variant={group.privacy === "CLOSED" ? "soft" : "default"}
      size={size}
      className={className}
      disabled={pending}
      onClick={join}
    >
      {pending ? <Spinner /> : <UserPlusIcon />}
      {group.privacy === "CLOSED"
        ? t("groups.requestToJoin")
        : t("groups.join")}
    </Button>
  )
}
