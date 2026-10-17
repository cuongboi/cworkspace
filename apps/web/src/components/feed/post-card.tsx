import { cn } from "cn"
import {
  ChevronRightIcon,
  LinkIcon,
  LockIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useState } from "react"
import { toast } from "sonner"
import { AttachmentList } from "@/components/common/attachment-list"
import { MentionTextarea } from "@/components/common/mention-textarea"
import { RichText } from "@/components/common/rich-text"
import { TimeAgo } from "@/components/common/time-ago"
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
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { useDbMutation } from "@/lib/query"
import type { ReactionType } from "@app/api/zenstack/models"
import { CommentsThread, useCanModerate } from "./comments-thread"
import { EventCard } from "./event-card"
import { PollWidget } from "./poll-widget"
import type { FeedPost } from "./post-query"
import { ReactionButton, ReactionSummary, withOptimistic } from "./reactions"

const LONG_POST = 700

export function PostCard({
  post,
  showGroup = true,
  commentsOpen: initialCommentsOpen = false,
  onDeleted,
}: {
  post: FeedPost
  /** show "Author ▸ Group" in the header (feeds that mix groups) */
  showGroup?: boolean
  commentsOpen?: boolean
  onDeleted?: () => void
}) {
  const { me } = useApp()
  const canModerate = useCanModerate(post)
  const isAuthor = post.authorId === me.id
  const [commentsOpen, setCommentsOpen] = useState(initialCommentsOpen)
  const [focusComposer, setFocusComposer] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(post.content)
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingReaction, setPendingReaction] = useState<
    ReactionType | null | undefined
  >(undefined)

  const reactions = withOptimistic(post.reactions, me, pendingReaction)
  const myReaction = reactions.find((r) => r.userId === me.id)?.type ?? null
  const permalink = `/posts/${post.id}`

  const react = useDbMutation(
    (type: ReactionType | null) =>
      type
        ? db.postReaction.upsert({
            where: { postId_userId: { postId: post.id, userId: me.id } },
            create: { postId: post.id, type },
            update: { type },
          })
        : db.postReaction.delete({
            where: { postId_userId: { postId: post.id, userId: me.id } },
          }),
    { invalidates: ["postReaction", "post"] }
  )
  const save = useDbMutation(
    (content: string) =>
      db.post.update({
        where: { id: post.id },
        data: { content, editedAt: new Date() },
      }),
    { invalidates: ["post"] }
  )
  const pin = useDbMutation(
    (pinned: boolean) =>
      db.post.update({
        where: { id: post.id },
        data: { pinnedAt: pinned ? new Date() : null },
      }),
    { invalidates: ["post"] }
  )
  const remove = useDbMutation(
    () => db.post.delete({ where: { id: post.id } }),
    { invalidates: ["post"] }
  )

  const submitEdit = () => {
    const content = draft.trim()
    if (!content && post.type === "TEXT" && post.attachments.length === 0)
      return
    save.mutate(content, {
      onSuccess: () => setEditing(false),
      onError: (err) => toast.error(err.message),
    })
  }

  const long = post.content.length > LONG_POST && !expanded
  const content = long
    ? `${post.content.slice(0, LONG_POST).trimEnd()}…`
    : post.content

  return (
    <Card className="gap-0 py-0">
      <article aria-labelledby={`post-${post.id}-author`}>
        <header className="flex items-start gap-3 px-4 pt-4">
          <Link to={`/people/${post.author.id}`} className="shrink-0">
            <UserAvatar user={post.author} presence />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-1 text-sm leading-tight font-semibold">
              <Link
                id={`post-${post.id}-author`}
                to={`/people/${post.author.id}`}
                className="hover:underline"
              >
                {post.author.name}
              </Link>
              {showGroup ? (
                <>
                  <ChevronRightIcon
                    className="size-3.5 text-muted-foreground"
                    aria-label="posted in"
                  />
                  <Link
                    to={`/groups/${post.group.slug}`}
                    className="hover:underline"
                  >
                    {post.group.name}
                  </Link>
                </>
              ) : null}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Link to={permalink} className="hover:underline">
                <TimeAgo date={post.createdAt} />
              </Link>
              {post.editedAt ? <span>· Edited</span> : null}
              {post.group.privacy !== "PUBLIC" ? (
                <LockIcon
                  className="size-3"
                  aria-label={`${post.group.privacy.toLowerCase()} group`}
                />
              ) : null}
            </p>
          </div>
          {post.pinnedAt ? (
            <Badge variant="secondary" className="shrink-0">
              <PinIcon />
              Pinned
            </Badge>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mt-1 -mr-2 text-muted-foreground"
                aria-label="Post actions"
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem
                onSelect={() => {
                  void navigator.clipboard
                    .writeText(`${window.location.origin}${permalink}`)
                    .then(() => toast.success("Link copied"))
                }}
              >
                <LinkIcon />
                Copy link
              </DropdownMenuItem>
              {canModerate ? (
                <DropdownMenuItem
                  onSelect={() =>
                    pin.mutate(!post.pinnedAt, {
                      onSuccess: () =>
                        toast.success(
                          post.pinnedAt
                            ? "Unpinned"
                            : "Pinned to the top of the group"
                        ),
                      onError: (err) => toast.error(err.message),
                    })
                  }
                >
                  {post.pinnedAt ? <PinOffIcon /> : <PinIcon />}
                  {post.pinnedAt ? "Unpin post" : "Pin post"}
                </DropdownMenuItem>
              ) : null}
              {isAuthor ? (
                <DropdownMenuItem
                  onSelect={() => {
                    setDraft(post.content)
                    setEditing(true)
                  }}
                >
                  <PencilIcon />
                  Edit post
                </DropdownMenuItem>
              ) : null}
              {isAuthor || canModerate ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <Trash2Icon />
                    Delete post
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="flex flex-col gap-3 px-4 pt-3 pb-3">
          {editing ? (
            <div className="flex flex-col gap-2">
              <MentionTextarea
                value={draft}
                onChange={setDraft}
                rows={4}
                autoFocus
                aria-label="Edit post"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false)
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    submitEdit()
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={submitEdit}
                  disabled={save.isPending}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : post.content ? (
            <div>
              <RichText
                text={content}
                className={cn(
                  post.content.length < 90 &&
                    !post.poll &&
                    !post.event &&
                    post.attachments.length === 0
                    ? "text-lg leading-snug"
                    : "text-sm"
                )}
              />
              {long ? (
                <button
                  type="button"
                  className="text-sm font-semibold hover:underline"
                  onClick={() => setExpanded(true)}
                >
                  See more
                </button>
              ) : null}
            </div>
          ) : null}
          <AttachmentList attachments={post.attachments} />
          {post.poll ? <PollWidget poll={post.poll} /> : null}
          {post.event ? <EventCard event={post.event} /> : null}
        </div>

        {reactions.length > 0 || post._count.comments > 0 ? (
          <div className="flex items-center justify-between gap-2 px-4 pb-2">
            <ReactionSummary reactions={reactions} />
            {post._count.comments > 0 ? (
              <button
                type="button"
                className="ml-auto text-sm text-muted-foreground hover:underline"
                aria-expanded={commentsOpen}
                onClick={() => setCommentsOpen((o) => !o)}
              >
                {post._count.comments} comment
                {post._count.comments === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mx-4 flex items-center gap-1 border-t py-1">
          <ReactionButton
            current={myReaction}
            onChange={(type) => {
              setPendingReaction(type)
              react.mutate(type, {
                onError: (err) => toast.error(err.message),
                onSettled: () => setPendingReaction(undefined),
              })
            }}
          />
          <Button
            variant="ghost"
            className="flex-1 font-semibold text-muted-foreground"
            onClick={() => {
              setCommentsOpen(true)
              setFocusComposer(true)
            }}
          >
            <MessageCircleIcon />
            Comment
          </Button>
        </div>

        {commentsOpen ? (
          <div className="border-t px-4 py-3">
            <CommentsThread post={post} autoFocus={focusComposer} />
          </div>
        ) : null}
      </article>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              The post, its comments and reactions will be removed for everyone.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Post deleted")
                    onDeleted?.()
                  },
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

export function PostSkeleton() {
  return (
    <Card className="gap-3 py-4" aria-hidden>
      <div className="flex items-center gap-3 px-4">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="flex flex-col gap-2 px-4">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <div className="mx-4 flex gap-2 border-t pt-3">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 flex-1" />
      </div>
    </Card>
  )
}
