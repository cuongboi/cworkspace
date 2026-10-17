import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { type ReactNode, useState } from "react"
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
import { useApp } from "@/hooks/use-app"
import { ApiError, api, db } from "@/lib/api-client"
import { invalidateModels } from "@/lib/query"
import { PeoplePicker, type PickedUser } from "./people-picker"

/** Pick one person → open the DM; pick several → create a group conversation. */
export function NewConversationDialog({ children }: { children: ReactNode }) {
  const { me } = useApp()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [people, setPeople] = useState<PickedUser[]>([])
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const isGroup = people.length > 1

  const reset = () => {
    setPeople([])
    setTitle("")
    setBusy(false)
  }

  const submit = async () => {
    if (people.length === 0 || busy) return
    setBusy(true)
    try {
      let id: string
      if (!isGroup) {
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
        err instanceof ApiError
          ? err.message
          : "Could not start the conversation"
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
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Choose one person for a direct message, or several to start a group.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <PeoplePicker value={people} onChange={setPeople} autoFocus />
          {isGroup ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-chat-title">Group name (optional)</Label>
              <Input
                id="new-chat-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Launch squad"
                maxLength={100}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={people.length === 0 || busy}>
              {busy ? <Spinner /> : null}
              {isGroup ? `Create group (${people.length + 1})` : "Chat"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
