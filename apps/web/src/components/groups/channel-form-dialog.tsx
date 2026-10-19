import { useQueryClient } from "@tanstack/react-query"
import { HashIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
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
        toast.success(`Saved #${slug}`)
      } else {
        const created = await api.post<{ id: string }>(
          `/api/groups/${groupId}/channels`,
          body
        )
        toast.success(`Created #${slug}`)
        void navigate(`/groups/${groupSlug}/c/${created.id}`)
      }
      await invalidateModels(qc, ["channel"])
      setOpen(false)
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not save the channel"
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
              {channel ? "Edit channel" : "New channel"}
            </DialogTitle>
            <DialogDescription>
              Channels are chat rooms everyone in the group can join.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-name">Name</Label>
            <div className="relative">
              <HashIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. design-review"
                maxLength={60}
                autoFocus
                disabled={editingGeneral}
                className="pl-7"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {name && slug !== name.trim().replace(/^#+/, "")
                ? `Will be created as #${slug || "…"}`
                : "Lowercase letters, numbers, - and _."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-parent">Inside</Label>
            <Select
              value={parentId ?? NO_PARENT}
              onValueChange={(v) => setParentId(v === NO_PARENT ? null : v)}
              disabled={editingGeneral || hasChildren}
            >
              <SelectTrigger id="channel-parent" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>Top level</SelectItem>
                {parents.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    # {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasChildren ? (
              <p className="text-xs text-muted-foreground">
                Channels with sub-channels stay at the top level.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="channel-topic">
              Topic <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="channel-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What is this channel about?"
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
              Cancel
            </Button>
            <Button type="submit" disabled={!slug || busy}>
              {busy ? <Spinner /> : null}
              {channel ? "Save" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
