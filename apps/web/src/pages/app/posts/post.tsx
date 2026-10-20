import { ArrowLeftIcon, FileQuestionIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
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
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"

/** Single post with its comments expanded (notifications link here). */
const PostPage = () => {
  const params = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { me } = useApp()
  const postId = params.postId ?? ""

  const { data: post, isPending } = useDbQuery(
    ["post", "findFirst", "permalink", postId, me.id],
    () =>
      db.post.findFirst({
        where: { id: postId },
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
          window.history.length > 1 ? navigate(-1) : navigate("/")
        }
      >
        <ArrowLeftIcon />
        {t("common.back")}
      </Button>
      {isPending ? (
        <PostSkeleton />
      ) : post ? (
        <PostCard
          post={post}
          commentsOpen
          onDeleted={() =>
            void navigate(`/groups/${post.group.slug}`, { replace: true })
          }
        />
      ) : (
        <Empty className="rounded-xl border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileQuestionIcon />
            </EmptyMedia>
            <EmptyTitle>{t("feed.postPage.notFoundTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("feed.postPage.notFoundBody")}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link to={"/"}>{t("feed.postPage.backToFeed")}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </FeedShell>
  )
}

export default PostPage
