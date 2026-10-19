import { cn } from "cn"
import type { ReactNode } from "react"

/** Muted page background with a centered column, the Workplace feed look. */
export function FeedShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className="-m-4 min-h-[calc(100svh-3rem)] bg-muted/50 p-4 md:-m-6 md:p-6">
      <div
        className={cn(
          "mx-auto flex w-full max-w-2xl flex-col gap-4",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}
