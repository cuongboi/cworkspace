import { MessageCircleIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { UserAvatar } from "@/components/common/user-avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useApp } from "@/hooks/use-app"

export type PersonSummary = {
  id: string
  name: string
  image: string | null
  title: string | null
  department: string | null
}

export function PersonCard({ person }: { person: PersonSummary }) {
  const { me } = useApp()
  const profile = `/people/${person.id}`
  return (
    <Card className="items-center gap-3 px-4 py-5 text-center">
      <Link to={profile} tabIndex={-1} aria-hidden>
        <UserAvatar user={person} size="xl" presence />
      </Link>
      <div className="flex max-w-full min-w-0 flex-col gap-0.5">
        <Link to={profile} className="truncate font-semibold hover:underline">
          {person.name}
        </Link>
        <p className="truncate text-sm text-muted-foreground">
          {person.title || " "}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {person.department || " "}
        </p>
      </div>
      {person.id === me.id ? (
        <Button asChild variant="outline" size="sm" className="w-full">
          <Link to={profile}>View profile</Link>
        </Button>
      ) : (
        <Button asChild variant="secondary" size="sm" className="w-full">
          <Link to={`/chat?with=${person.id}`}>
            <MessageCircleIcon />
            Message
          </Link>
        </Button>
      )}
    </Card>
  )
}

export function PersonCardSkeleton() {
  return (
    <Card className="items-center gap-3 px-4 py-5" aria-hidden>
      <Skeleton className="size-20 rounded-full" />
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-full" />
    </Card>
  )
}
