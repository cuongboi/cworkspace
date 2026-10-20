import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { Markdown } from "./markdown"

type Exportable = { title: string; content: string }

const PRINT_CSS = `
  body { font: 15px/1.65 system-ui, sans-serif; color: #18181b; max-width: 46rem; margin: 2.5rem auto; padding: 0 1rem; }
  h1, h2, h3, h4 { line-height: 1.3; } h2 { border-bottom: 1px solid #e4e4e7; padding-bottom: .25rem; }
  pre { background: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 8px; padding: .75rem; overflow-x: auto; white-space: pre-wrap; }
  code { font-family: ui-monospace, monospace; font-size: .9em; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #e4e4e7; padding: .35rem .7rem; text-align: left; }
  blockquote { border-left: 2px solid #d4d4d8; margin-left: 0; padding-left: 1rem; color: #52525b; }
  img { max-width: 100%; } button, [data-slot=code-block-actions] { display: none; }
  a { color: inherit; } ul.contains-task-list { list-style: none; padding-left: .25rem; }
`

function slug(title: string) {
  return (
    title
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || "page"
  )
}

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: name,
  })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const escape = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c
  )

/** A standalone document rendered with the same reader as the page (image URLs made absolute). */
function toHtml(page: Exportable) {
  const body = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(Markdown, null, page.content)
    )
  ).replaceAll('src="/api/', `src="${location.origin}/api/`)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(page.title)}</title><style>${PRINT_CSS}</style></head><body><h1>${escape(page.title)}</h1>${body}</body></html>`
}

export function exportMarkdown(page: Exportable) {
  download(
    `${slug(page.title)}.md`,
    "text/markdown",
    `# ${page.title}\n\n${page.content}`
  )
}

export function exportHtml(page: Exportable) {
  download(`${slug(page.title)}.html`, "text/html", toHtml(page))
}

/** PDF through the browser's print dialog ("Save as PDF"): no PDF library to ship. */
export function exportPdf(page: Exportable) {
  const frame = Object.assign(document.createElement("iframe"), {
    style: "position:fixed;width:0;height:0;border:0",
  })
  document.body.append(frame)
  const doc = frame.contentDocument
  if (!doc) return frame.remove()
  doc.open()
  doc.write(toHtml(page))
  doc.close()
  let printed = false
  const print = () => {
    if (printed) return
    printed = true
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1000)
  }
  // wait for images so they make it into the PDF (but never forever)
  const pending = Array.from(doc.images).filter((img) => !img.complete)
  if (!pending.length) return print()
  let left = pending.length
  const settle = () => --left || print()
  for (const img of pending) {
    img.addEventListener("load", settle, { once: true })
    img.addEventListener("error", settle, { once: true })
  }
  setTimeout(print, 5000)
}
