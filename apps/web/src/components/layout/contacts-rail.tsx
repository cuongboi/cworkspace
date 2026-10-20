import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { UserAvatar } from "@/components/common/user-avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useApp } from "@/hooks/use-app"
import { useOnlineUsers } from "@/hooks/use-presence"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"

/** Right rail: everyone in the company, online first. Clicking opens a 1:1 chat. */
export function ContactsRail() {
  const { t } = useTranslation()
  const { me } = useApp()
  const online = useOnlineUsers()
  const { data: people = [] } = useDbQuery(
    ["user", "findMany", "contacts"],
    () =>
      db.user.findMany({
        where: {
          id: { not: me.id },
        },
        select: { id: true, name: true, image: true, title: true },
        orderBy: { name: "asc" },
        take: 100,
      })
  )
  const sorted = [...people].sort(
    (a, b) => Number(online.has(b.id)) - Number(online.has(a.id))
  )

  return (
    <aside className="hidden w-64 shrink-0 border-l xl:block">
      <div className="flex h-full flex-col">
        <h2 className="px-4 pt-4 pb-2 text-sm font-semibold text-muted-foreground">
          {t("shell.contacts")}
        </h2>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="px-2 pb-4">
            {sorted.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/chat?with=${p.id}`}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <UserAvatar user={p} size="sm" presence />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </Link>
              </li>
            ))}
            {sorted.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">
                {t("shell.inviteTeam")}
              </li>
            ) : null}
          </ul>
        </ScrollArea>
      </div>
    </aside>
  )
}
