import { cn } from "cn"
import { ChevronRightIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

/**
 * Building blocks of the dense secondary sidebars (chat, groups): 28px rows, small muted counts,
 * and collapsible sections whose state is remembered per viewer.
 */
export const sidebarRowClass =
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-xs transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"

export function SidebarCount({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
      {children}
    </span>
  )
}

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/**
 * Open/closed state of one collapsible item, kept in a localStorage list under `storageKey`
 * (a per-viewer convenience). The list holds the ids that differ from `defaultOpen`.
 */
export function usePersistedOpen(
  storageKey: string,
  id: string,
  defaultOpen = true
) {
  const [open, setOpen] = useState(() =>
    readList(storageKey).includes(id) ? !defaultOpen : defaultOpen
  )
  const update = (next: boolean) => {
    setOpen(next)
    try {
      const rest = readList(storageKey).filter((s) => s !== id)
      localStorage.setItem(
        storageKey,
        JSON.stringify(next === defaultOpen ? rest : [...rest, id])
      )
    } catch {
      // storage unavailable: keep the in-memory state
    }
  }
  return [open, update] as const
}

export function SidebarSection({
  id,
  storageKey,
  label,
  action,
  children,
  empty = "None yet",
}: {
  id: string
  storageKey: string
  label: string
  /** e.g. a `+` button, shown at the end of the header */
  action?: ReactNode
  children: ReactNode[]
  empty?: ReactNode
}) {
  const [open, setOpen] = usePersistedOpen(storageKey, id)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group/section flex h-7 items-center justify-between pr-1 pl-2">
        <CollapsibleTrigger className="flex items-center gap-1 rounded-sm text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          {label}
          <ChevronRightIcon
            className={cn(
              "size-3 opacity-0 transition-[transform,opacity] group-hover/section:opacity-100",
              open && "rotate-90"
            )}
          />
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent>
        <nav aria-label={label} className="flex flex-col gap-px">
          {children.length ? (
            children
          ) : (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              {empty}
            </p>
          )}
        </nav>
      </CollapsibleContent>
    </Collapsible>
  )
}
