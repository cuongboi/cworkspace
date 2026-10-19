import { useQueryClient } from "@tanstack/react-query"
import { addHours, format } from "date-fns"
import {
  BellOffIcon,
  CalendarDaysIcon,
  FileIcon,
  FolderOpenIcon,
  LogOutIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  ShieldIcon,
  UserPlusIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { type ReactNode, useState } from "react"
import { useQueryState } from "nuqs"
import { toast } from "sonner"
import { formatBytes } from "@/components/common/attachment-list"
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
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useApp } from "@/hooks/use-app"
import { useNow } from "@/hooks/use-now"
import { useIsOnline } from "@/hooks/use-presence"
import { ApiError, db } from "@/lib/api-client"
import { invalidateModels, useDbQuery } from "@/lib/query"
import { type ChatInfoTab, chatInfoTabParser } from "@/lib/search-params"
import { fileUrl } from "@/lib/upload"
import {
  conversationFilesKey,
  conversationTitle,
  fetchConversationFiles,
  otherUsers,
  type ThreadConversation,
  type ThreadMember,
} from "./chat-data"
import { ConversationAvatar } from "./conversation-avatar"
import { PeoplePicker, type PickedUser } from "./people-picker"

const FOREVER = new Date("9999-12-31T00:00:00.000Z")

const MUTE_OPTIONS = [
  { value: "off", label: "Not muted" },
  { value: "1", label: "For 1 hour" },
  { value: "8", label: "For 8 hours" },
  { value: "24", label: "For 24 hours" },
  { value: "forever", label: "Until I turn it back on" },
] as const

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback

type Props = {
  conversation: ThreadConversation
  members: ThreadMember[]
  /** called after leaving, so a sheet host can close itself */
  onLeft?: () => void
}

/** Conversation details: Info · Files · Members. Rendered as a column (desktop) or in a sheet. */
export function ConversationInfoPanel({
  conversation,
  members,
  onLeft,
}: Props) {
  const { me } = useApp()
  const [tab, setTab] = useQueryState("infoTab", chatInfoTabParser)
  const isGroup = conversation.type === "GROUP"
  const title = conversationTitle(conversation, members, me.id)
  const other = !isGroup ? otherUsers(members, me.id)[0] : undefined
  const otherOnline = useIsOnline(other?.id)

  return (
    <Tabs
      value={tab}
      onValueChange={(v) =>
        void setTab(v === "info" ? null : (v as ChatInfoTab))
      }
      className="flex h-full min-h-0 flex-col gap-0 bg-muted/40"
    >
      <div className="flex flex-col items-center gap-1.5 px-5 pt-6 pb-4 text-center">
        <ConversationAvatar
          type={conversation.type}
          group={conversation.group}
          members={members}
          meId={me.id}
          size="lg"
        />
        <h2 className="mt-1 max-w-full truncate text-sm font-semibold">
          {title}
        </h2>
        <p className="text-[11px] text-muted-foreground">
          {isGroup
            ? `${members.length} members`
            : otherOnline
              ? "Active now"
              : "Direct message"}
        </p>
      </div>
      <div className="px-5">
        <TabsList className="h-8 w-full p-0.5">
          <TabsTrigger value="info" className="text-[11px]">
            Info
          </TabsTrigger>
          <TabsTrigger value="files" className="text-[11px]">
            Files
          </TabsTrigger>
          <TabsTrigger value="members" className="text-[11px]">
            Members
          </TabsTrigger>
        </TabsList>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 pt-5 pb-6">
          <TabsContent value="info">
            <InfoTab
              conversation={conversation}
              members={members}
              onLeft={onLeft}
            />
          </TabsContent>
          <TabsContent value="files">
            <FilesTab conversationId={conversation.id} />
          </TabsContent>
          <TabsContent value="members">
            <MembersTab conversation={conversation} members={members} />
          </TabsContent>
        </div>
      </ScrollArea>
    </Tabs>
  )
}

function SectionTitle({
  children,
  actions,
}: {
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex min-h-7 items-center justify-between">
      <h3 className="text-[13px] font-semibold">{children}</h3>
      {actions ? <div className="flex items-center">{actions}</div> : null}
    </div>
  )
}

function Property({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-9 items-center gap-2.5 text-xs">
      <span className="text-muted-foreground [&_svg]:size-3.5">{icon}</span>
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-[11px] text-foreground/80">
        {children}
      </span>
    </div>
  )
}

function InfoTab({ conversation, members, onLeft }: Props) {
  const { me } = useApp()
  const now = useNow()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isGroup = conversation.type === "GROUP"
  // a group's chat is managed through the group (members, name), not here
  const linkedGroup = conversation.group
  const myMember = members.find((m) => m.userId === me.id)
  const other = !isGroup ? otherUsers(members, me.id)[0] : undefined
  const [name, setName] = useState(conversation.title ?? "")
  const [savingName, setSavingName] = useState(false)

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
    myMember?.mutedUntil && myMember.mutedUntil.getTime() > now
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
      onLeft?.()
      await navigate("/chat")
      await refresh()
      toast.success("You left the conversation")
    } catch (err) {
      toast.error(errorMessage(err, "Could not leave the conversation"))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col">
        <SectionTitle>Main info</SectionTitle>
        <Property icon={<MessagesSquareIcon />} label="Type">
          {linkedGroup
            ? "Group chat"
            : isGroup
              ? "Group conversation"
              : "Direct message"}
        </Property>
        {isGroup ? (
          <Property icon={<UserRoundIcon />} label="Creator">
            {conversation.createdBy.name}
          </Property>
        ) : null}
        <Property icon={<CalendarDaysIcon />} label="Created">
          {format(conversation.createdAt, "d MMM yyyy")}
        </Property>
        <div className="flex min-h-9 items-center gap-2.5 text-xs">
          <BellOffIcon className="size-3.5 text-muted-foreground" />
          <label htmlFor="chat-mute" className="flex-1 text-muted-foreground">
            Notifications
          </label>
          <Select
            value={mutedUntil ? "custom" : "off"}
            onValueChange={(v) => void setMute(v)}
          >
            <SelectTrigger
              id="chat-mute"
              size="sm"
              className="h-7 max-w-40 border-0 bg-transparent px-1.5 text-[11px] shadow-none hover:bg-accent"
            >
              <SelectValue>
                {mutedUntil
                  ? mutedUntil.getTime() === FOREVER.getTime()
                    ? "Muted"
                    : `Muted until ${format(mutedUntil, "HH:mm, d MMM")}`
                  : "On"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {MUTE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {isGroup && !linkedGroup ? (
        <>
          <Separator />
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void rename()
            }}
          >
            <SectionTitle>
              <label htmlFor="chat-title">Conversation name</label>
            </SectionTitle>
            <div className="flex gap-1.5">
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
                className="h-8 bg-card text-xs shadow-none md:text-xs"
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={
                  savingName || name.trim() === (conversation.title ?? "")
                }
              >
                {savingName ? <Spinner /> : <PencilIcon />}
                Save
              </Button>
            </div>
          </form>
        </>
      ) : null}

      <Separator />
      <div className="flex flex-col gap-1">
        {other ? (
          <Button asChild variant="outline" size="sm" className="justify-start">
            <Link to={`/people/${other.id}`}>
              <UserRoundIcon /> View profile
            </Link>
          </Button>
        ) : null}
        {linkedGroup ? (
          <Button asChild variant="outline" size="sm" className="justify-start">
            <Link to={`/groups/${linkedGroup.slug}`}>
              <UsersRoundIcon /> Open {linkedGroup.name}
            </Link>
          </Button>
        ) : isGroup ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="justify-start text-destructive hover:text-destructive"
              >
                <LogOutIcon /> Leave group
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave this group?</AlertDialogTitle>
                <AlertDialogDescription>
                  You'll stop receiving messages from this conversation. Someone
                  will have to add you back to rejoin.
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
        ) : null}
      </div>
    </div>
  )
}

function FilesTab({ conversationId }: { conversationId: string }) {
  const { data, isPending, error } = useDbQuery(
    conversationFilesKey(conversationId),
    () => fetchConversationFiles(conversationId)
  )

  if (isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <p className="py-6 text-center text-xs text-destructive">
        Could not load files.
      </p>
    )
  }
  if (!data.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
        <FolderOpenIcon className="size-5" />
        Files shared in this chat show up here.
      </div>
    )
  }

  const images = data.filter((f) => f.mimeType.startsWith("image/"))
  const others = data.filter((f) => !f.mimeType.startsWith("image/"))

  return (
    <div className="flex flex-col gap-4">
      {images.length ? (
        <section className="flex flex-col gap-2">
          <SectionTitle>Photos</SectionTitle>
          <ul className="grid grid-cols-3 gap-1.5">
            {images.map((f) => (
              <li key={f.id}>
                <a
                  href={fileUrl(f.id)}
                  target="_blank"
                  rel="noreferrer"
                  title={f.name}
                  className="block aspect-square overflow-hidden rounded-md border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <img
                    src={fileUrl(f.id)}
                    alt={f.name}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {others.length ? (
        <section className="flex flex-col gap-1">
          <SectionTitle>Files</SectionTitle>
          <ul className="flex flex-col">
            {others.map((f) => (
              <li key={f.id}>
                <a
                  href={fileUrl(f.id, { download: true })}
                  className="flex items-center gap-2.5 rounded-md px-1 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card">
                    <FileIcon className="size-3.5 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold">
                      {f.name}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {formatBytes(f.size)} · {f.uploader.name} ·{" "}
                      {format(f.createdAt, "d MMM")}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function MembersTab({
  conversation,
  members,
}: {
  conversation: ThreadConversation
  members: ThreadMember[]
}) {
  const { me } = useApp()
  const qc = useQueryClient()
  const myMember = members.find((m) => m.userId === me.id)
  const linkedGroup = conversation.group
  const iAmAdmin =
    conversation.type === "GROUP" && !linkedGroup && myMember?.role === "ADMIN"
  const [adding, setAdding] = useState(false)
  const [toAdd, setToAdd] = useState<PickedUser[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = () =>
    invalidateModels(qc, ["conversation", "conversationMember"])

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

  return (
    <section className="flex flex-col gap-1" aria-labelledby="chat-members">
      <SectionTitle
        actions={
          iAmAdmin && !adding ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add people"
              className="text-muted-foreground"
              onClick={() => setAdding(true)}
            >
              <UserPlusIcon />
            </Button>
          ) : null
        }
      >
        <span id="chat-members">
          Members{" "}
          <span className="text-[10px] font-normal text-muted-foreground">
            {members.length}
          </span>
        </span>
      </SectionTitle>

      {adding ? (
        <div className="mb-2 flex flex-col gap-2 rounded-lg border bg-card p-2.5">
          <PeoplePicker
            value={toAdd}
            onChange={setToAdd}
            exclude={members.map((m) => m.userId)}
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
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
          <li key={m.id} className="flex min-h-11 items-center gap-2.5">
            <UserAvatar user={m.user} presence className="size-7.5" />
            <Link
              to={`/people/${m.userId}`}
              className="min-w-0 flex-1 truncate text-[11px] font-semibold hover:underline"
            >
              {m.user.name}
              {m.userId === me.id ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  (you)
                </span>
              ) : null}
            </Link>
            {m.role === "ADMIN" ? (
              <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[9px] text-muted-foreground">
                Admin
              </span>
            ) : null}
            {iAmAdmin && m.userId !== me.id ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Manage ${m.user.name}`}
                    className="text-muted-foreground"
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      void setRole(m, m.role === "ADMIN" ? "MEMBER" : "ADMIN")
                    }
                  >
                    <ShieldIcon />{" "}
                    {m.role === "ADMIN" ? "Remove as admin" : "Make admin"}
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
      <p className="pt-3 text-[10px] text-muted-foreground">
        {members.length} {members.length === 1 ? "member" : "members"} in this
        chat
        {linkedGroup ? ` · managed in ${linkedGroup.name}` : ""}
      </p>
    </section>
  )
}
