import { format } from "date-fns"
import {
  BriefcaseIcon,
  Building2Icon,
  CalendarIcon,
  MailIcon,
  MapPinIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  UserXIcon,
} from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { type ReactNode, useState } from "react"
import { RichText } from "@/components/common/rich-text"
import { UserAvatar } from "@/components/common/user-avatar"
import { FeedShell } from "@/components/feed/feed-shell"
import { PostFeed } from "@/components/feed/post-feed"
import { EditProfileDialog } from "@/components/people/edit-profile-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useOrg } from "@/hooks/use-org"
import { useIsOnline } from "@/hooks/use-presence"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin" }

const ProfilePage = () => {
  const params = useParams()
  const { org, me, href } = useOrg()
  const userId = params.userId ?? ""
  const [editing, setEditing] = useState(false)
  const online = useIsOnline(userId)
  const isMe = userId === me.id

  const { data: user, isPending } = useDbQuery(
    ["user", "findFirst", "profile", org.id, userId],
    () =>
      db.user.findFirst({
        where: { id: userId, members: { some: { organizationId: org.id } } },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          title: true,
          department: true,
          location: true,
          phone: true,
          bio: true,
          members: {
            where: { organizationId: org.id },
            select: { role: true, createdAt: true },
          },
        },
      })
  )

  if (isPending) {
    return (
      <FeedShell>
        <Card className="items-center gap-3 py-8">
          <Skeleton className="size-24 rounded-full" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </Card>
      </FeedShell>
    )
  }

  if (!user) {
    return (
      <Empty className="mx-auto mt-10 max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserXIcon />
          </EmptyMedia>
          <EmptyTitle>Person not found</EmptyTitle>
          <EmptyDescription>They may have left {org.name}.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link to={href("/people")}>Browse people</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const membership = user.members[0]
  const roleLabel = membership ? ROLE_LABEL[membership.role] : undefined

  return (
    <FeedShell>
      <Card className="gap-0 overflow-hidden py-0">
        <div
          aria-hidden
          className="h-24 bg-gradient-to-br from-primary/25 via-primary/10 to-muted md:h-32"
        />
        <CardContent className="flex flex-col gap-4 px-6 pb-6">
          <div className="-mt-10 flex flex-wrap items-end justify-between gap-3">
            <UserAvatar
              user={user}
              size="xl"
              presence
              className="rounded-full ring-4 ring-card"
            />
            <div className="flex gap-2">
              {isMe ? (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <PencilIcon />
                  Edit profile
                </Button>
              ) : (
                <Button asChild>
                  <Link to={href(`/chat?with=${user.id}`)}>
                    <MessageCircleIcon />
                    Message
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight">
              {user.name}
              {roleLabel ? (
                <Badge variant="secondary">{roleLabel}</Badge>
              ) : null}
            </h1>
            {user.title ? (
              <p className="text-muted-foreground">{user.title}</p>
            ) : null}
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span
                aria-hidden
                className={
                  online || isMe
                    ? "size-2 rounded-full bg-emerald-500"
                    : "size-2 rounded-full bg-muted-foreground/40"
                }
              />
              {online || isMe ? "Active now" : "Offline"}
            </p>
          </div>
          {user.bio ? <RichText text={user.bio} className="text-sm" /> : null}
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail icon={<BriefcaseIcon />} label="Title" value={user.title} />
            <Detail
              icon={<Building2Icon />}
              label="Department"
              value={user.department}
            />
            <Detail
              icon={<MapPinIcon />}
              label="Location"
              value={user.location}
            />
            <Detail
              icon={<MailIcon />}
              label="Email"
              value={
                <a href={`mailto:${user.email}`} className="hover:underline">
                  {user.email}
                </a>
              }
            />
            <Detail
              icon={<PhoneIcon />}
              label="Phone"
              value={
                user.phone ? (
                  <a href={`tel:${user.phone}`} className="hover:underline">
                    {user.phone}
                  </a>
                ) : null
              }
            />
            {membership ? (
              <Detail
                icon={<CalendarIcon />}
                label="Joined"
                value={`Joined ${org.name} in ${format(membership.createdAt, "MMMM yyyy")}`}
              />
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <h2 className="mt-2 text-lg font-semibold">
        {isMe ? "Your posts" : `Posts by ${user.name.split(" ")[0]}`}
      </h2>
      <PostFeed
        scope={["author", org.id, user.id, me.id]}
        where={{ authorId: user.id, group: { organizationId: org.id } }}
        empty={
          <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
            No posts you can see yet.
          </p>
        }
      />

      {isMe && editing ? (
        <EditProfileDialog profile={user} onOpenChange={setEditing} />
      ) : null}
    </FeedShell>
  )
}

function Detail({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
}) {
  if (!value) return null
  return (
    <div className="flex min-w-0 items-start gap-2">
      <dt className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
        {icon}
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  )
}

export default ProfilePage
