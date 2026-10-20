import { cn } from "cn"
import { useEffect, useState, type RefObject } from "react"
import { useTranslation } from "react-i18next"

type Heading = { id: string; text: string; level: number }

/**
 * Table of contents for the rendered page: reads the h1–h3 the reader produced (so it always
 * matches what is shown), gives them anchors, and highlights the section in view.
 */
export function WikiOutline({
  bodyRef,
  content,
}: {
  bodyRef: RefObject<HTMLElement | null>
  /** re-scan when the page changes */
  content: string
}) {
  const { t } = useTranslation()
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const els = Array.from(body.querySelectorAll<HTMLElement>("h1, h2, h3"))
    els.forEach((el, i) => (el.id = `wiki-h-${i}`))
    setHeadings(
      els.map((el) => ({
        id: el.id,
        text: el.textContent ?? "",
        level: Number(el.tagName[1]),
      }))
    )
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting)
        if (visible) setActiveId(visible.target.id)
      },
      { rootMargin: "0px 0px -70% 0px" }
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [bodyRef, content])

  if (headings.length < 2) return null
  const top = Math.min(...headings.map((h) => h.level))
  return (
    <nav aria-label={t("wiki.outline")} className="flex flex-col gap-1 text-xs">
      <p className="mb-1 font-semibold text-foreground">{t("wiki.outline")}</p>
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${h.id}`}
          onClick={(e) => {
            e.preventDefault()
            document
              .getElementById(h.id)
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
            setActiveId(h.id)
          }}
          className={cn(
            "truncate border-l py-0.5 text-muted-foreground hover:text-foreground",
            h.id === activeId && "border-foreground font-medium text-foreground"
          )}
          style={{ paddingLeft: 8 + (h.level - top) * 10 }}
        >
          {h.text}
        </a>
      ))}
    </nav>
  )
}
