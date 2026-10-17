import { ArrowLeftIcon, FileQuestionIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { FeedShell } from "@/components/feed/feed-shell"
import { PostCard, PostSkeleton } from "@/components/feed/post-card"
import { postInclude } from "@/components/feed/post-query"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"

/** Single post with its comments expanded (notifications link here). */
const PostPage = () => {
  const params = useParams()
  const navigate = useNavigate()
  const { org, me, href } = useOrg()
  const postId = params.postId ?? ""

  const { data: post, isPending } = useDbQuery(
    ["post", "findFirst", "permalink", postId, me.id],
    () =>
      db.post.findFirst({
        where: { id: postId, group: { organizationId: org.id } },
        include: postInclude(me.id),
      })
  )

  return (
    <FeedShell>
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        onClick={() =>
          window.history.length > 1 ? navigate(-1) : navigate(href("/"))
        }
      >
        <ArrowLeftIcon />
        Back
      </Button>
      {isPending ? (
        <PostSkeleton />
      ) : post ? (
        <PostCard
          post={post}
          commentsOpen
          onDeleted={() =>
            void navigate(href(`/groups/${post.group.slug}`), { replace: true })
          }
        />
      ) : (
        <Empty className="rounded-xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileQuestionIcon />
            </EmptyMedia>
            <EmptyTitle>Post not available</EmptyTitle>
            <EmptyDescription>
              It may have been deleted, or it's in a group you can't see.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link to={href("/")}>Back to feed</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </FeedShell>
  )
}

export default PostPage
