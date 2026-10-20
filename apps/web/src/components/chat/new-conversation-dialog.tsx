import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useApp } from "@/hooks/use-app"
import { ApiError, api, db } from "@/lib/api-client"
import { invalidateModels } from "@/lib/query"
import { PeoplePicker, type PickedUser } from "./people-picker"

type NewKind = "chat" | "channel"

/**
 * Chat: pick one person → open the DM; pick several → create a group conversation.
 * Channel: a named CHANNEL conversation (Slack-style threads) with any number of members.
 */
export function NewConversationDialog({
  children,
  defaultKind = "chat",
}: {
  children: ReactNode
  defaultKind?: NewKind
}) {
  const { t } = useTranslation()
  const { me } = useApp()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<PickedUser[]>([])
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<NewKind>(defaultKind)
  const isChannel = kind === "channel"
  const isGroup = !isChannel && people.length > 1
  const canSubmit = isChannel ? title.trim().length > 0 : people.length > 0

  const reset = () => {
    setPeople([])
    setTitle("")
    setBusy(false)
    setKind(defaultKind)
  }

  const submit = async () => {
    if (!canSubmit || busy) return
    setBusy(true)
    try {
      let id: string
      if (isChannel) {
        ;({ id } = await db.conversation.create({
          data: {
            type: "CHANNEL",
            title: title.trim().replace(/^#/, ""),
            members: {
              create: [
                { userId: me.id, role: "ADMIN" },
                ...people.map((p) => ({ userId: p.id })),
              ],
            },
          },
          select: { id: true },
        }))
      } else if (!isGroup) {
        const first = people[0] as PickedUser
        ;({ id } = await api.post<{ id: string }>("/api/conversations/direct", {
          userId: first.id,
        }))
      } else {
        ;({ id } = await db.conversation.create({
          data: {
            type: "GROUP",
            title: title.trim() || null,
            members: {
              create: [
                { userId: me.id, role: "ADMIN" },
                ...people.map((p) => ({ userId: p.id })),
              ],
            },
          },
          select: { id: true },
        }))
      }
      void invalidateModels(qc, ["conversation", "conversationMember"])
      setOpen(false)
      reset()
      await navigate(`/chat/${id}`)
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("chat.newDialog.startFailed")
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("chat.newDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("chat.newDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={kind}
            onValueChange={(v) => v && setKind(v as NewKind)}
            className="self-start"
          >
            <ToggleGroupItem value="chat">
              {t("chat.newDialog.kindChat")}
            </ToggleGroupItem>
            <ToggleGroupItem value="channel">
              {t("chat.newDialog.kindChannel")}
            </ToggleGroupItem>
          </ToggleGroup>
          {isChannel ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-channel-name">
                {t("chat.newDialog.channelName")}
              </Label>
              <Input
                id="new-channel-name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("chat.newDialog.channelNamePlaceholder")}
                maxLength={80}
                required
              />
            </div>
          ) : null}
          <PeoplePicker
            value={people}
            onChange={setPeople}
            autoFocus={!isChannel}
          />
          {isGroup ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-chat-title">
                {t("chat.newDialog.groupName")}
              </Label>
              <Input
                id="new-chat-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("chat.newDialog.groupNamePlaceholder")}
                maxLength={100}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit || busy}>
              {busy ? <Spinner /> : null}
              {isChannel
                ? t("chat.newDialog.createChannel")
                : isGroup
                  ? t("chat.newDialog.createGroup", {
                      count: people.length + 1,
                    })
                  : t("chat.newDialog.chat")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
