import { NewspaperIcon, UsersIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { FeedShell } from "@/components/feed/feed-shell"
import { PostComposer } from "@/components/feed/post-composer"
import { PostFeed } from "@/components/feed/post-feed"
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

/** News feed: posts from every group I'm an active member of, newest first. */
const HomePage = () => {
  const { me } = useApp()

  return (
    <FeedShell>
      <h1 className="sr-only">News feed</h1>
      <PostComposer />
      <PostFeed
        scope={["home", me.id]}
        where={{
          group: {
            members: { some: { userId: me.id, status: "ACTIVE" } },
          },
        }}
        empty={
          <Empty className="rounded-xl border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <NewspaperIcon />
              </EmptyMedia>
              <EmptyTitle>Your feed is quiet</EmptyTitle>
              <EmptyDescription>
                Write the first post above, or join groups to see what your
                colleagues are sharing.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline">
                <Link to={"/groups"}>
                  <UsersIcon />
                  Discover groups
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        }
      />
    </FeedShell>
  )
}

export default HomePage
