import { cn } from "cn"
import {
  MoreHorizontalIcon,
  PaperclipIcon,
  SendHorizontalIcon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { type ClipboardEvent, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { AttachmentList } from "@/components/common/attachment-list"
import { LinkPreviews } from "@/components/common/link-previews"
import { MentionTextarea } from "@/components/common/mention-textarea"
import { RichText } from "@/components/common/rich-text"
import { TimeAgo } from "@/components/common/time-ago"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useApp } from "@/hooks/use-app"
import { useUploads } from "@/hooks/use-uploads"
import { db } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { formatMention } from "@/lib/mentions"
import { useDbMutation, useDbQuery } from "@/lib/query"
import type { ReactionType } from "@app/api/zenstack/models"
import { type FeedComment, type FeedPost, findComments } from "./post-query"
import { ReactionButton, ReactionSummary, withOptimistic } from "./reactions"

/** Group admins/moderators of the post's group, and instance admins, can moderate. */
export function useCanModerate(post: FeedPost) {
  const { isAdmin } = useApp()
  const role = post.group.members[0]?.role
  return isAdmin || role === "ADMIN" || role === "MODERATOR"
}

/** All comments of a post with one level of replies, plus the composer. */
export function CommentsThread({
  post,
  autoFocus = false,
}: {
  post: FeedPost
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const { me } = useApp()
  const { data: comments, isPending } = useDbQuery(
    ["comment", "findMany", "post", post.id],
    () => findComments(post.id)
  )
  const [replyTo, setReplyTo] = useState<{
    parentId: string
    mention: string
  } | null>(null)

  const top = (comments ?? []).filter((c) => !c.parentId)
  const repliesOf = (id: string) =>
    (comments ?? []).filter((c) => c.parentId === id)

  return (
    <div className="flex flex-col gap-3">
      {isPending ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-12 w-2/3 rounded-2xl" />
            </div>
          ))}
        </div>
      ) : (
        top.map((c) => (
          <div key={c.id} className="flex flex-col gap-2">
            <CommentItem
              comment={c}
              post={post}
              onReply={() => setReplyTo({ parentId: c.id, mention: "" })}
            />
            {(repliesOf(c.id).length > 0 || replyTo?.parentId === c.id) && (
              <div className="ml-10 flex flex-col gap-2">
                {repliesOf(c.id).map((r) => (
                  <CommentItem
                    key={r.id}
                    comment={r}
                    post={post}
                    onReply={() =>
                      setReplyTo({
                        parentId: c.id,
                        mention:
                          r.authorId === c.authorId || r.authorId === me.id
                            ? ""
                            : `${formatMention(r.author.name, r.author.id)} `,
                      })
                    }
                  />
                ))}
                {replyTo?.parentId === c.id ? (
                  <CommentComposer
                    key={`${replyTo.parentId}-${replyTo.mention}`}
                    postId={post.id}
                    parentId={c.id}
                    initial={replyTo.mention}
                    autoFocus
                    placeholder={t("feed.comments.replyTo", {
                      name: c.author.name,
                    })}
                    onDone={() => setReplyTo(null)}
                  />
                ) : null}
              </div>
            )}
          </div>
        ))
      )}
      <CommentComposer
        postId={post.id}
        autoFocus={autoFocus}
        placeholder={t("feed.comments.placeholder")}
      />
    </div>
  )
}

function CommentItem({
  comment,
  post,
  onReply,
}: {
  comment: FeedComment
  post: FeedPost
  onReply: () => void
}) {
  const { t } = useTranslation()
  const { me } = useApp()
  const canModerate = useCanModerate(post)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.content)
  const [pendingReaction, setPendingReaction] = useState<
    ReactionType | null | undefined
  >(undefined)
  const isMine = comment.authorId === me.id
  const canDelete = isMine || post.authorId === me.id || canModerate

  const reactions = withOptimistic(comment.reactions, me, pendingReaction)
  const myReaction = reactions.find((r) => r.userId === me.id)?.type ?? null

  const react = useDbMutation(
    (type: ReactionType | null) =>
      type
        ? db.commentReaction.upsert({
            where: {
              commentId_userId: { commentId: comment.id, userId: me.id },
            },
            create: { commentId: comment.id, type },
            update: { type },
          })
        : db.commentReaction.delete({
            where: {
              commentId_userId: { commentId: comment.id, userId: me.id },
            },
          }),
    { invalidates: ["commentReaction", "comment"] }
  )
  const save = useDbMutation(
    (content: string) =>
      db.comment.update({
        where: { id: comment.id },
        data: { content, editedAt: new Date() },
      }),
    { invalidates: ["comment"] }
  )
  const remove = useDbMutation(
    () => db.comment.delete({ where: { id: comment.id } }),
    {
      invalidates: ["comment", "post"],
    }
  )

  const submitEdit = () => {
    const content = draft.trim()
    if (!content) return
    save.mutate(content, {
      onSuccess: () => setEditing(false),
      onError: (err) => toast.error(errorMessage(err)),
    })
  }

  return (
    <div className="group/comment flex gap-2">
      <Link to={`/people/${comment.author.id}`} className="shrink-0">
        <UserAvatar user={comment.author} size="sm" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <div className="flex flex-col gap-2">
            <MentionTextarea
              value={draft}
              onChange={setDraft}
              onSubmit={submitEdit}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false)
              }}
              rows={2}
              autoFocus
              aria-label={t("feed.comments.edit")}
            />
            <div className="flex gap-2 text-xs">
              <Button
                size="xs"
                onClick={submitEdit}
                disabled={save.isPending || !draft.trim()}
              >
                {t("common.save")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-1">
            <div className="relative max-w-full min-w-0 rounded-2xl bg-muted px-3 py-2">
              <Link
                to={`/people/${comment.author.id}`}
                className="text-sm font-semibold hover:underline"
              >
                {comment.author.name}
              </Link>
              {comment.content ? (
                <RichText text={comment.content} className="text-sm" />
              ) : null}
              {comment.content ? (
                <LinkPreviews
                  text={comment.content}
                  max={1}
                  className="mt-1.5"
                />
              ) : null}
              {reactions.length > 0 ? (
                <ReactionSummary
                  reactions={reactions}
                  compact
                  className="absolute -right-2 -bottom-3"
                />
              ) : null}
            </div>
            {isMine || canDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="mt-1 text-muted-foreground opacity-100 group-hover/comment:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 md:opacity-0"
                    aria-label={t("feed.comments.actions")}
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isMine ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        setDraft(comment.content)
                        setEditing(true)
                      }}
                    >
                      {t("common.edit")}
                    </DropdownMenuItem>
                  ) : null}
                  {canDelete ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() =>
                        remove.mutate(undefined, {
                          onError: (err) => toast.error(errorMessage(err)),
                        })
                      }
                    >
                      {t("common.delete")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        )}
        <AttachmentList
          attachments={comment.attachments}
          className="max-w-sm"
        />
        {!editing ? (
          <div className="flex items-center gap-3 px-3 text-xs">
            <ReactionButton
              size="compact"
              current={myReaction}
              onChange={(type) => {
                setPendingReaction(type)
                react.mutate(type, {
                  onError: (err) => toast.error(errorMessage(err)),
                  onSettled: () => setPendingReaction(undefined),
                })
              }}
            />
            <button
              type="button"
              className="font-semibold text-muted-foreground hover:underline"
              onClick={onReply}
            >
              {t("feed.comments.reply")}
            </button>
            <TimeAgo
              date={comment.createdAt}
              className="text-muted-foreground"
            />
            {comment.editedAt ? (
              <span className="text-muted-foreground">{t("feed.edited")}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function CommentComposer({
  postId,
  parentId,
  initial = "",
  autoFocus,
  placeholder,
  onDone,
}: {
  postId: string
  parentId?: string
  initial?: string
  autoFocus?: boolean
  placeholder?: string
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const { me } = useApp()
  const [content, setContent] = useState(initial)
  const uploads = useUploads()
  const fileRef = useRef<HTMLInputElement>(null)

  const create = useDbMutation(
    (vars: { content: string }) =>
      db.comment.create({
        data: {
          postId,
          content: vars.content,
          ...(parentId ? { parentId } : {}),
          attachments: uploads.connect(),
        },
      }),
    { invalidates: ["comment", "post"] }
  )

  const canSend =
    (content.trim() || uploads.attachments.length > 0) && !uploads.uploading
  const submit = () => {
    if (!canSend || create.isPending) return
    create.mutate(
      { content: content.trim() },
      {
        onSuccess: () => {
          setContent("")
          uploads.reset()
          onDone?.()
        },
        onError: (err) => toast.error(errorMessage(err)),
      }
    )
  }

  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length) {
      e.preventDefault()
      void uploads.add(e.clipboardData.files)
    }
  }

  return (
    <div className="flex gap-2" onPaste={onPaste}>
      <UserAvatar user={me} size="sm" className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-end gap-1 rounded-2xl bg-muted px-2 py-1">
          <MentionTextarea
            value={content}
            onChange={setContent}
            onSubmit={submit}
            onKeyDown={(e) => {
              if (e.key === "Escape" && onDone) onDone()
            }}
            rows={1}
            autoFocus={autoFocus}
            placeholder={placeholder}
            aria-label={placeholder ?? t("feed.comments.placeholder")}
            className="min-h-8 border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void uploads.add(e.target.files)
              e.target.value = ""
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={t("feed.attachFiles")}
            onClick={() => fileRef.current?.click()}
          >
            <PaperclipIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "shrink-0",
              canSend ? "text-primary" : "text-muted-foreground"
            )}
            aria-label={t("feed.comments.send")}
            disabled={!canSend || create.isPending}
            onClick={submit}
          >
            {create.isPending || uploads.uploading ? (
              <Spinner />
            ) : (
              <SendHorizontalIcon />
            )}
          </Button>
        </div>
        <AttachmentList
          attachments={uploads.attachments}
          onRemove={uploads.remove}
          className="max-w-xs"
        />
      </div>
    </div>
  )
}
