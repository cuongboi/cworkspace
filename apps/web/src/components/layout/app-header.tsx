import { SearchIcon } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useState } from "react"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useOrg } from "@/hooks/use-org"

export function AppHeader() {
  const [searchParams] = useSearchParams()
  const q = searchParams.get("q") ?? ""

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-1 h-0" />
      {/* re-mount when ?q= changes so the box follows the URL */}
      <SearchForm key={q} initial={q} />
      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />
      </div>
    </header>
  )
}

function SearchForm({ initial }: { initial: string }) {
  const navigate = useNavigate()
  const { href } = useOrg()
  const [q, setQ] = useState(initial)
  return (
    <form
      className="relative w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault()
        if (q.trim())
          void navigate(href(`/search?q=${encodeURIComponent(q.trim())}`))
      }}
    >
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people, groups and posts"
        className="h-9 pl-8"
        aria-label="Search"
      />
    </form>
  )
}
