import { useQueryClient } from "@tanstack/react-query"
import { HashIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, api } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { invalidateModels, useDbQuery } from "@/lib/query"
import {
  type ChannelItem,
  channelsKey,
  fetchChannels,
  normalizeChannelName,
} from "./channel-data"

const NO_PARENT = "__top"

/** Create a channel (`channel` unset) or edit one: name with a live `#` preview, parent, topic. */
export function ChannelFormDialog({
  groupId,
  groupSlug,
  channel,
  defaultParentId,
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  groupId: string
  groupSlug: string
  channel?: ChannelItem
  defaultParentId?: string | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [innerOpen, setInnerOpen] = useState(false)
  const open = controlledOpen ?? innerOpen
  const setOpen = (o: boolean) => {
    setInnerOpen(o)
    onOpenChange?.(o)
  }
  const [name, setName] = useState(channel?.name ?? "")
  const [topic, setTopic] = useState(channel?.topic ?? "")
  const [parentId, setParentId] = useState<string | null>(
    channel ? channel.parentId : (defaultParentId ?? null)
  )
  const [busy, setBusy] = useState(false)
  const { data: channels = [] } = useDbQuery(
    channelsKey(groupId),
    () => fetchChannels(groupId),
    { enabled: open }
  )

  const slug = normalizeChannelName(name)
  const hasChildren = channel
    ? channels.some((c) => c.parentId === channel.id)
    : false
  // one nesting level: only top-level channels (not itself) can be parents
  const parents = channels.filter((c) => !c.parentId && c.id !== channel?.id)
  const editingGeneral = channel?.isDefault ?? false

  const reset = () => {
    setName(channel?.name ?? "")
    setTopic(channel?.topic ?? "")
    setParentId(channel ? channel.parentId : (defaultParentId ?? null))
  }

  const submit = async () => {
    if (!slug || busy) return
    setBusy(true)
    try {
      const body = { name: slug, parentId, topic: topic.trim() || null }
      if (channel) {
        await api.patch(`/api/channels/${channel.id}`, body)
        toast.success(t("groups.channelForm.saved", { name: slug }))
      } else {
        const created = await api.post<{ id: string }>(
          `/api/groups/${groupId}/channels`,
          body
        )
        toast.success(t("groups.channelForm.created", { name: slug }))
        void navigate(`/groups/${groupSlug}/c/${created.id}`)
      }
      await invalidateModels(qc, ["channel"])
      setOpen(false)
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? errorMessage(err)
          : t("groups.channelForm.saveFailed")
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset()
        setOpen(o)
      }}
    >
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {channel
                ? t("groups.channelForm.editTitle")
                : t("groups.newChannel")}
            </DialogTitle>
            <DialogDescription>
              {t("groups.channelForm.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">{t("groups.form.name")}</Label>
            <div className="relative">
              <HashIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("groups.channelForm.namePlaceholder")}
                maxLength={60}
                autoFocus
                disabled={editingGeneral}
                className="pl-7"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {name && slug !== name.trim().replace(/^#+/, "")
                ? t("groups.channelForm.willBe", { name: slug || "…" })
                : t("groups.channelForm.nameHint")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-parent">
              {t("groups.channelForm.inside")}
            </Label>
            <Select
              value={parentId ?? NO_PARENT}
              onValueChange={(v) => setParentId(v === NO_PARENT ? null : v)}
              disabled={editingGeneral || hasChildren}
            >
              <SelectTrigger id="channel-parent" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>
                  {t("groups.channelForm.topLevel")}
                </SelectItem>
                {parents.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    # {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasChildren ? (
              <p className="text-xs text-muted-foreground">
                {t("groups.channelForm.hasChildren")}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-topic">
              {t("groups.channelForm.topic")}{" "}
              <span className="text-muted-foreground">
                {t("groups.channelForm.optional")}
              </span>
            </Label>
            <Textarea
              id="channel-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t("groups.channelForm.topicPlaceholder")}
              maxLength={250}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!slug || busy}>
              {busy ? <Spinner /> : null}
              {channel ? t("common.save") : t("groups.channelForm.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
