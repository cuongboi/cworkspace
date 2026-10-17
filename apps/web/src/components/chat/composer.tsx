import { useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import {
  PaperclipIcon,
  PencilIcon,
  ReplyIcon,
  SendHorizontalIcon,
  XIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AttachmentList } from "@/components/common/attachment-list"
import { MentionTextarea } from "@/components/common/mention-textarea"
import { Button } from "@/components/ui/button"
import { useMessageScroller } from "@/components/ui/message-scroller"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useOrg } from "@/hooks/use-org"
import { useSocket } from "@/hooks/use-socket"
import type { useUploads } from "@/hooks/use-uploads"
import { ApiError, db } from "@/lib/api-client"
import { toPlainText } from "@/lib/mentions"
import {
  type ChatMessage,
  findCachedMessage,
  insertMessage,
  messageInclude,
  messagesKey,
  patchMessage,
  removeMessage,
  replaceMessage,
  tempId,
} from "./chat-data"

export type ComposerMode =
  | { kind: "reply"; message: ChatMessage }
  | { kind: "edit"; message: ChatMessage }

type Props = {
  conversationId: string
  mode: ComposerMode | null
  onModeChange: (mode: ComposerMode | null) => void
  uploads: ReturnType<typeof useUploads>
  disabled?: boolean
}

const TYPING_THROTTLE_MS = 2000

export function Composer({
  conversationId,
  mode,
  onModeChange,
  uploads,
  disabled,
}: Props) {
  const { me } = useOrg()
  const qc = useQueryClient()
  const socket = useSocket()
  const { scrollToEnd } = useMessageScroller()
  const [value, setValue] = useState("")
  const [draft, setDraft] = useState("")
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastTypingRef = useRef(0)

  // entering edit mode loads the message into the box; leaving it restores the draft
  const editingId = mode?.kind === "edit" ? mode.message.id : null
  const [prevEditingId, setPrevEditingId] = useState<string | null>(null)
  if (editingId !== prevEditingId) {
    setPrevEditingId(editingId)
    if (editingId && mode?.kind === "edit") {
      if (!prevEditingId) setDraft(value)
      setValue(mode.message.content)
    } else {
      setValue(draft)
      setDraft("")
    }
  }

  const modeKey = mode ? `${mode.kind}:${mode.message.id}` : ""
  useEffect(() => {
    if (modeKey)
      requestAnimationFrame(() =>
        wrapperRef.current?.querySelector("textarea")?.focus()
      )
  }, [modeKey])

  const emitTyping = (next: string) => {
    if (!socket || !next.trim() || mode?.kind === "edit") return
    const now = Date.now()
    if (now - lastTypingRef.current < TYPING_THROTTLE_MS) return
    lastTypingRef.current = now
    socket.emit("typing", { conversationId })
  }

  const sendMessage = (content: string) => {
    const replyTo = mode?.kind === "reply" ? mode.message : null
    const attachments = uploads.attachments
    const connect = uploads.connect()
    const temp: ChatMessage = {
      id: tempId(),
      conversationId,
      senderId: me.id,
      content,
      type: "TEXT",
      data: null,
      replyToId: replyTo?.id ?? null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      sender: { id: me.id, name: me.name, image: me.image ?? null },
      attachments,
      reactions: [],
      replyTo: replyTo
        ? {
            id: replyTo.id,
            content: replyTo.content,
            deletedAt: replyTo.deletedAt,
            senderId: replyTo.senderId,
            sender: { name: replyTo.sender.name },
          }
        : null,
      pending: true,
    }
    insertMessage(qc, temp)
    setValue("")
    uploads.reset()
    onModeChange(null)
    lastTypingRef.current = 0
    requestAnimationFrame(() => scrollToEnd({ behavior: "smooth" }))

    db.message
      .create({
        data: {
          conversationId,
          content,
          replyToId: replyTo?.id ?? null,
          attachments: connect,
        },
        include: messageInclude,
      })
      .then((saved) => replaceMessage(qc, conversationId, temp.id, saved))
      .catch((err: unknown) => {
        removeMessage(qc, conversationId, temp.id)
        toast.error(
          err instanceof ApiError ? err.message : "Message not sent",
          {
            description: toPlainText(content).slice(0, 80) || undefined,
          }
        )
        // give the text back if the box is still empty
        setValue((v) => (v ? v : content))
      })
  }

  const saveEdit = (message: ChatMessage, content: string) => {
    if (content === message.content) return onModeChange(null)
    const previous = { content: message.content, editedAt: message.editedAt }
    const editedAt = new Date()
    patchMessage(qc, conversationId, message.id, (m) => ({
      ...m,
      content,
      editedAt,
    }))
    onModeChange(null)
    db.message
      .update({
        where: { id: message.id },
        data: { content, editedAt },
        select: { id: true },
      })
      .catch((err: unknown) => {
        patchMessage(qc, conversationId, message.id, (m) => ({
          ...m,
          ...previous,
        }))
        toast.error(
          err instanceof ApiError ? err.message : "Could not edit the message"
        )
      })
  }

  const submit = () => {
    if (disabled) return
    const content = value.trim()
    if (mode?.kind === "edit") {
      if (!content)
        return void toast.error("A message can't be empty. Unsend it instead.")
      return saveEdit(mode.message, content)
    }
    if (uploads.uploading)
      return void toast("Hang on, attachments are still uploading")
    if (!content && uploads.attachments.length === 0) return
    sendMessage(content)
  }

  const editLastOwn = () => {
    const data = qc.getQueryData<{ pages: ChatMessage[][] }>(
      messagesKey(conversationId)
    )
    const mineLatest = data?.pages
      .flat()
      .find(
        (m) =>
          m.senderId === me.id &&
          m.type === "TEXT" &&
          !m.deletedAt &&
          !m.pending &&
          m.content.trim()
      )
    if (mineLatest) onModeChange({ kind: "edit", message: mineLatest })
  }

  const canSend =
    mode?.kind === "edit"
      ? value.trim().length > 0
      : value.trim().length > 0 || uploads.attachments.length > 0
  const quoted = mode
    ? (findCachedMessage(qc, conversationId, mode.message.id) ?? mode.message)
    : null

  return (
    <div
      ref={wrapperRef}
      className="shrink-0 border-t bg-background px-3 pt-2 pb-3 md:px-4"
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files)
        if (files.length === 0 || mode?.kind === "edit") return
        e.preventDefault()
        void uploads.add(files)
      }}
    >
      {mode && quoted ? (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          {mode.kind === "reply" ? (
            <ReplyIcon
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <PencilIcon
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">
              {mode.kind === "edit"
                ? "Editing message"
                : `Replying to ${quoted.senderId === me.id ? "yourself" : quoted.sender.name}`}
            </p>
            {mode.kind === "reply" ? (
              <p className="truncate text-xs text-muted-foreground">
                {toPlainText(quoted.content) ||
                  (quoted.attachments.length ? "Attachment" : "")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Press Enter to save, Esc to cancel
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="rounded-full"
            onClick={() => onModeChange(null)}
            aria-label={
              mode.kind === "edit" ? "Cancel editing" : "Cancel reply"
            }
          >
            <XIcon />
          </Button>
        </div>
      ) : null}

      {mode?.kind !== "edit" &&
      (uploads.attachments.length > 0 || uploads.pending.length > 0) ? (
        <div className="mb-2 flex max-h-56 flex-col gap-2 overflow-y-auto">
          <AttachmentList
            attachments={uploads.attachments}
            onRemove={uploads.remove}
            className="max-w-sm"
          />
          {uploads.pending.map((p) => (
            <div
              key={p.key}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <Spinner className="size-3.5" />
              <span className="truncate">Uploading {p.name}…</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-1.5">
        {mode?.kind !== "edit" ? (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void uploads.add(e.target.files)
                e.target.value = ""
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 rounded-full text-primary"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Attach files"
                  disabled={disabled}
                >
                  <PaperclipIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Attach files</TooltipContent>
            </Tooltip>
          </>
        ) : null}
        <div className="min-w-0 flex-1">
          <MentionTextarea
            value={value}
            onChange={(next) => {
              setValue(next)
              emitTyping(next)
            }}
            onSubmit={submit}
            onKeyDown={(e) => {
              if (e.key === "Escape" && mode) {
                e.preventDefault()
                onModeChange(null)
              } else if (e.key === "ArrowUp" && !value && !mode) {
                e.preventDefault()
                editLastOwn()
              }
            }}
            placeholder={disabled ? "You can't send messages here" : "Aa"}
            aria-label="Message"
            rows={1}
            disabled={disabled}
            className={cn(
              "field-sizing-content max-h-40 min-h-9 rounded-2xl bg-muted px-3.5 py-2 shadow-none",
              "border-transparent focus-visible:border-ring"
            )}
          />
        </div>
        {canSend || mode ? (
          <Button
            size="icon"
            className="shrink-0 rounded-full"
            onClick={submit}
            disabled={
              !canSend ||
              disabled ||
              (uploads.uploading && mode?.kind !== "edit")
            }
            aria-label={mode?.kind === "edit" ? "Save" : "Send"}
          >
            {uploads.uploading && mode?.kind !== "edit" ? (
              <Spinner />
            ) : (
              <SendHorizontalIcon />
            )}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full text-xl"
            onClick={() => !disabled && !uploads.uploading && sendMessage("👍")}
            disabled={disabled || uploads.uploading}
            aria-label="Send a like"
          >
            <span aria-hidden="true">👍</span>
          </Button>
        )}
      </div>
    </div>
  )
}
