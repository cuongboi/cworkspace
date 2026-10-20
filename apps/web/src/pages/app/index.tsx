import { NewspaperIcon, UsersIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
  const { me } = useApp()

  return (
    <FeedShell>
      <h1 className="sr-only">{t("feed.home.title")}</h1>
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
              <EmptyTitle>{t("feed.home.emptyTitle")}</EmptyTitle>
              <EmptyDescription>{t("feed.home.emptyBody")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline">
                <Link to={"/groups"}>
                  <UsersIcon />
                  {t("feed.home.discoverGroups")}
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
