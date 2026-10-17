import { useQueryClient } from "@tanstack/react-query"
import { addHours } from "date-fns"
import {
  BellOffIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  ShieldIcon,
  UserPlusIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { useOrg } from "@/hooks/use-org"
import { useIsOnline } from "@/hooks/use-presence"
import { ApiError, db } from "@/lib/api-client"
import { invalidateModels } from "@/lib/query"
import {
  conversationTitle,
  otherUsers,
  type ThreadConversation,
  type ThreadMember,
} from "./chat-data"
import { ConversationAvatar } from "./conversation-avatar"
import { PeoplePicker, type PickedUser } from "./people-picker"
import { ScrollArea } from "@/components/ui/scroll-area"

const FOREVER = new Date("9999-12-31T00:00:00.000Z")

const MUTE_OPTIONS = [
  { value: "off", label: "Not muted" },
  { value: "1", label: "For 1 hour" },
  { value: "8", label: "For 8 hours" },
  { value: "24", label: "For 24 hours" },
  { value: "forever", label: "Until I turn it back on" },
] as const

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversation: ThreadConversation
  members: ThreadMember[]
}

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback

export function ConversationInfoSheet({
  open,
  onOpenChange,
  conversation,
  members,
}: Props) {
  const { me, href } = useOrg()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isGroup = conversation.type === "GROUP"
  const myMember = members.find((m) => m.userId === me.id)
  // a group's chat is managed through the group (members, name), not here
  const linkedGroup = conversation.group
  const iAmAdmin = !linkedGroup && myMember?.role === "ADMIN"
  const title = conversationTitle(conversation, members, me.id)
  const other = !isGroup ? otherUsers(members, me.id)[0] : undefined
  const otherOnline = useIsOnline(other?.id)

  const [name, setName] = useState(conversation.title ?? "")
  const [savingName, setSavingName] = useState(false)
  const [adding, setAdding] = useState(false)
  const [toAdd, setToAdd] = useState<PickedUser[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    invalidateModels(qc, ["conversation", "conversationMember"])

  const rename = async () => {
    setSavingName(true)
    try {
      await db.conversation.update({
        where: { id: conversation.id },
        data: { title: name.trim() || null },
        select: { id: true },
      })
      await refresh()
      toast.success("Conversation renamed")
    } catch (err) {
      toast.error(errorMessage(err, "Could not rename the conversation"))
    } finally {
      setSavingName(false)
    }
  }

  const mutedUntil =
    myMember?.mutedUntil && myMember.mutedUntil > new Date()
      ? myMember.mutedUntil
      : null
  const setMute = async (value: string) => {
    const until =
      value === "off"
        ? null
        : value === "forever"
          ? FOREVER
          : addHours(new Date(), Number(value))
    try {
      await db.conversationMember.update({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: me.id,
          },
        },
        data: { mutedUntil: until },
        select: { id: true },
      })
      await refresh()
      toast.success(until ? "Conversation muted" : "Conversation unmuted")
    } catch (err) {
      toast.error(errorMessage(err, "Could not update notifications"))
    }
  }

  const addMembers = async () => {
    if (toAdd.length === 0) return
    setBusy(true)
    try {
      await Promise.all(
        toAdd.map((u) =>
          db.conversationMember.create({
            data: { conversationId: conversation.id, userId: u.id },
            select: { id: true },
          })
        )
      )
      await refresh()
      toast.success(
        toAdd.length === 1
          ? `${toAdd[0]?.name} was added`
          : `${toAdd.length} people were added`
      )
      setToAdd([])
      setAdding(false)
    } catch (err) {
      toast.error(errorMessage(err, "Could not add people"))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (member: ThreadMember) => {
    try {
      await db.conversationMember.delete({
        where: { id: member.id },
        select: { id: true },
      })
      await refresh()
      toast.success(`${member.user.name} was removed`)
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove this person"))
    }
  }

  const setRole = async (member: ThreadMember, role: "ADMIN" | "MEMBER") => {
    try {
      await db.conversationMember.update({
        where: { id: member.id },
        data: { role },
        select: { id: true },
      })
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err, "Could not change the role"))
    }
  }

  const leave = async () => {
    try {
      await db.conversationMember.delete({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: me.id,
          },
        },
        select: { id: true },
      })
      onOpenChange(false)
      await navigate(href("/chat"))
      await refresh()
      toast.success("You left the conversation")
    } catch (err) {
      toast.error(errorMessage(err, "Could not leave the conversation"))
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-sm">
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName="[&>div]:h-full"
        >
          <div className="flex min-h-full flex-col">
            <SheetHeader className="items-center pt-8 text-center">
              <ConversationAvatar
                type={conversation.type}
                group={linkedGroup}
                members={members}
                meId={me.id}
                size="lg"
                className="size-16"
              />
              <SheetTitle className="mt-2 text-lg">{title}</SheetTitle>
              <SheetDescription>
                {isGroup
                  ? `${members.length} members`
                  : otherOnline
                    ? "Active now"
                    : "Direct message"}
              </SheetDescription>
              {other ? (
                <Button asChild variant="secondary" size="sm" className="mt-2">
                  <Link to={href(`/people/${other.id}`)}>
                    <UserRoundIcon /> View profile
                  </Link>
                </Button>
              ) : null}
            </SheetHeader>

            <div className="flex flex-col gap-6 px-4 pb-6">
              {isGroup && !linkedGroup ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void rename()
                  }}
                >
                  <Label htmlFor="chat-title">Conversation name</Label>
                  <div className="flex gap-2">
                    <Input
                      id="chat-title"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={conversationTitle(
                        { type: "GROUP", title: null },
                        members,
                        me.id
                      )}
                      maxLength={100}
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={
                        savingName || name.trim() === (conversation.title ?? "")
                      }
                    >
                      {savingName ? <Spinner /> : null}
                      Save
                    </Button>
                  </div>
                </form>
              ) : null}

              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="chat-mute"
                  className="flex items-center gap-1.5"
                >
                  <BellOffIcon className="size-4" /> Mute notifications
                </Label>
                <Select
                  value={mutedUntil ? "custom" : "off"}
                  onValueChange={(v) => void setMute(v)}
                >
                  <SelectTrigger id="chat-mute" className="w-full">
                    <SelectValue>
                      {mutedUntil
                        ? mutedUntil.getTime() === FOREVER.getTime()
                          ? "Muted until you turn it back on"
                          : `Muted until ${mutedUntil.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
                        : "Not muted"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MUTE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isGroup ? (
                <>
                  <Separator />
                  <section
                    className="flex flex-col gap-2"
                    aria-labelledby="chat-members-heading"
                  >
                    <div className="flex items-center justify-between">
                      <h3
                        id="chat-members-heading"
                        className="text-sm font-semibold"
                      >
                        Members · {members.length}
                      </h3>
                      {iAmAdmin && !adding ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAdding(true)}
                        >
                          <UserPlusIcon /> Add people
                        </Button>
                      ) : null}
                    </div>

                    {adding ? (
                      <div className="flex flex-col gap-2 rounded-lg border p-3">
                        <PeoplePicker
                          value={toAdd}
                          onChange={setToAdd}
                          exclude={members.map((m) => m.userId)}
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setAdding(false)
                              setToAdd([])
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={toAdd.length === 0 || busy}
                            onClick={() => void addMembers()}
                          >
                            {busy ? <Spinner /> : null}
                            Add{toAdd.length ? ` ${toAdd.length}` : ""}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <ul className="flex flex-col">
                      {members.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center gap-3 rounded-md px-1 py-1.5"
                        >
                          <UserAvatar user={m.user} presence />
                          <div className="min-w-0 flex-1">
                            <Link
                              to={href(`/people/${m.userId}`)}
                              className="block truncate text-sm font-medium hover:underline"
                            >
                              {m.user.name}
                              {m.userId === me.id ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  (you)
                                </span>
                              ) : null}
                            </Link>
                          </div>
                          {m.role === "ADMIN" ? (
                            <Badge variant="secondary">Admin</Badge>
                          ) : null}
                          {iAmAdmin && m.userId !== me.id ? (
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
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={() =>
                                    void setRole(
                                      m,
                                      m.role === "ADMIN" ? "MEMBER" : "ADMIN"
                                    )
                                  }
                                >
                                  <ShieldIcon />{" "}
                                  {m.role === "ADMIN"
                                    ? "Remove as admin"
                                    : "Make admin"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => void removeMember(m)}
                                >
                                  <LogOutIcon /> Remove from group
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>

                  <Separator />
                  {linkedGroup ? (
                    <Button asChild variant="secondary">
                      <Link to={href(`/groups/${linkedGroup.slug}`)}>
                        <UsersRoundIcon /> Open group
                      </Link>
                    </Button>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          className="justify-start text-destructive hover:text-destructive"
                        >
                          <LogOutIcon /> Leave group
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Leave this group?</AlertDialogTitle>
                          <AlertDialogDescription>
                            You'll stop receiving messages from this
                            conversation. Someone will have to add you back to
                            rejoin.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => void leave()}
                          >
                            Leave group
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
