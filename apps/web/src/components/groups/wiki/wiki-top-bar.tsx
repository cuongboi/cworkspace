import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import type { WikiTreeRow } from "./wiki-query"

/** The doc pane's header: breadcrumb (group › parents › page) and the page actions. */
export function WikiTopBar({
  leading,
  groupName,
  ancestors = [],
  title,
  onSelect,
  children,
}: {
  leading?: ReactNode
  groupName: string
  ancestors?: WikiTreeRow[]
  title?: string
  onSelect?: (id: string | null) => void
  children?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4">
      {leading}
      <nav
        aria-label={t("wiki.breadcrumb")}
        className="flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground"
      >
        <button
          type="button"
          className="shrink-0 truncate hover:text-foreground"
          onClick={() => onSelect?.(null)}
        >
          {t("wiki.groupWiki", { name: groupName })}
        </button>
        {ancestors.map((a) => (
          <span key={a.id} className="flex min-w-0 items-center gap-1">
            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
            <button
              type="button"
              className="truncate hover:text-foreground"
              onClick={() => onSelect?.(a.id)}
            >
              {a.title}
            </button>
          </span>
        ))}
        {title ? (
          <span className="flex min-w-0 items-center gap-1">
            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate font-medium text-foreground">
              {title}
            </span>
          </span>
        ) : null}
      </nav>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </header>
  )
}
