import { cn } from "cn"
import { Link } from "react-router-dom"
import { parseText } from "@/lib/mentions"

/** Renders user text: preserves line breaks, links URLs and `@[Name](userId)` mentions. */
export function RichText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <p className={cn("break-words whitespace-pre-wrap", className)}>
      {parseText(text).map((seg, i) => {
        const key = `${i}-${seg.kind}`
        if (seg.kind === "mention") {
          return (
            <Link
              key={key}
              to={`/people/${seg.userId}`}
              className="font-medium text-primary hover:underline"
            >
              @{seg.name}
            </Link>
          )
        }
        if (seg.kind === "link") {
          return (
            <a
              key={key}
              href={seg.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-primary underline-offset-2 hover:underline"
            >
              {seg.url}
            </a>
          )
        }
        return <span key={key}>{seg.text}</span>
      })}
    </p>
  )
}
