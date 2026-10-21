import {
  BarChart3Icon,
  ImageIcon,
  PaperclipIcon,
  UsersIcon,
} from "lucide-react"
import { type ClipboardEvent, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { AttachmentList } from "@/components/common/attachment-list"
import { LinkPreviews } from "@/components/common/link-previews"
import { MentionTextarea } from "@/components/common/mention-textarea"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { useApp } from "@/hooks/use-app"
import { useDebounced } from "@/hooks/use-debounced"
import { useUploads } from "@/hooks/use-uploads"
import { db } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { useDbMutation, useDbQuery } from "@/lib/query"
import {
  emptyPoll,
  PollBuilder,
  type PollDraft,
  pollCreateInput,
  pollIsValid,
} from "./poll-builder"

/**
 * "What's on your mind?" composer. With `groupId` it posts to that group; otherwise the author
 * picks one of their groups (defaults to "All company").
 */
export function PostComposer({
  groupId,
  groupName,
}: {
  groupId?: string
  groupName?: string
}) {
  const { t } = useTranslation()
  const { me } = useApp()
  const [content, setContent] = useState("")
  const [poll, setPoll] = useState<PollDraft | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const uploads = useUploads()
  const fileRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)

  const { data: myGroups = [] } = useDbQuery(
    ["groupMember", "findMany", "composer", me.id],
    () =>
      db.groupMember.findMany({
        where: {
          userId: me.id,
          status: "ACTIVE",
        },
        select: {
          group: { select: { id: true, name: true, isDefault: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    { enabled: !groupId }
  )
  const defaultGroup =
    myGroups.find((m) => m.group.isDefault)?.group ?? myGroups[0]?.group
  const targetId = groupId ?? picked ?? defaultGroup?.id ?? null

  const create = useDbMutation(
    (vars: { groupId: string; content: string; poll: PollDraft | null }) =>
      db.post.create({
        data: {
          groupId: vars.groupId,
          content: vars.content,
          type: vars.poll ? "POLL" : "TEXT",
          attachments: uploads.connect(),
          ...(vars.poll ? { poll: pollCreateInput(vars.poll) } : {}),
        },
      }),
    { invalidates: ["post"] }
  )

  // preview what the post will show, without a request per keystroke
  const previewText = useDebounced(content, 500)
  const hasBody = content.trim().length > 0 || uploads.attachments.length > 0
  const canPost =
    Boolean(targetId) &&
    !uploads.uploading &&
    (poll ? pollIsValid(poll) : hasBody) &&
    !create.isPending

  const submit = () => {
    if (!canPost || !targetId) return
    create.mutate(
      { groupId: targetId, content: content.trim(), poll },
      {
        onSuccess: () => {
          setContent("")
          setPoll(null)
          uploads.reset()
          setExpanded(false)
          toast.success(t("feed.composer.posted"))
        },
        onError: (err) => toast.error(errorMessage(err)),
      }
    )
  }

  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length) {
      e.preventDefault()
      setExpanded(true)
      void uploads.add(e.clipboardData.files)
    }
  }

  const open = expanded || hasBody || poll !== null || uploads.uploading

  return (
    <Card className="gap-3 py-4" onPaste={onPaste}>
      <div className="flex gap-3 px-4">
        <UserAvatar user={me} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <MentionTextarea
            value={content}
            onChange={setContent}
            onFocus={() => setExpanded(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
            rows={open ? 3 : 1}
            placeholder={
              groupName
                ? t("feed.composer.placeholderGroup", { group: groupName })
                : t("feed.composer.placeholder", {
                    name: me.name.split(" ")[0],
                  })
            }
            aria-label={t("feed.composer.label")}
            className="min-h-10 rounded-2xl border-0 bg-muted px-4 py-2.5 shadow-none focus-visible:ring-1 dark:bg-muted"
          />
        </div>
      </div>

      {previewText &&
      uploads.attachments.length === 0 &&
      uploads.pending.length === 0 ? (
        <LinkPreviews text={previewText} max={1} className="px-4" />
      ) : null}

      {uploads.attachments.length > 0 || uploads.pending.length > 0 ? (
        <div className="flex flex-col gap-2 px-4">
          <AttachmentList
            attachments={uploads.attachments}
            onRemove={uploads.remove}
          />
          {uploads.pending.map((p) => (
            <div
              key={p.key}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <Spinner className="size-3.5" />
              {t("feed.composer.uploading", { name: p.name })}
            </div>
          ))}
        </div>
      ) : null}

      {poll ? (
        <div className="px-4">
          <PollBuilder
            value={poll}
            onChange={setPoll}
            onRemove={() => setPoll(null)}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 border-t px-0 pt-3 md:px-3">
        <input
          ref={imageRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void uploads.add(e.target.files)
            e.target.value = ""
            setExpanded(true)
          }}
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void uploads.add(e.target.files)
            e.target.value = ""
            setExpanded(true)
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => imageRef.current?.click()}
        >
          <ImageIcon />
          {t("feed.composer.photoVideo")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => fileRef.current?.click()}
        >
          <PaperclipIcon />
          {t("feed.composer.file")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          aria-pressed={poll !== null}
          onClick={() => {
            setPoll((p) => (p ? null : emptyPoll()))
            setExpanded(true)
          }}
        >
          <BarChart3Icon />
          {t("feed.poll.title")}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {!groupId && open ? (
            <Select value={targetId ?? undefined} onValueChange={setPicked}>
              <SelectTrigger
                size="sm"
                className="max-w-44"
                aria-label={t("feed.composer.postToGroup")}
              >
                <UsersIcon />
                <SelectValue placeholder={t("feed.composer.chooseGroup")} />
              </SelectTrigger>
              <SelectContent align="end">
                {myGroups.map(({ group }) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {open ? (
            <Button size="sm" onClick={submit} disabled={!canPost}>
              {create.isPending ? <Spinner /> : null}
              {t("feed.composer.post")}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
