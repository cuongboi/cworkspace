import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ApiError, db } from "@/lib/api-client"
import i18n, { errorMessage } from "@/lib/i18n"
import { invalidateModels } from "@/lib/query"
import type { WikiPageDetail } from "./wiki-query"

export const AUTOSAVE_DELAY_MS = 1200
/** Autosaves add a history entry at most this often; ⌘S and Done always add one. */
const REVISION_EVERY_MS = 5 * 60 * 1000

export type SaveStatus = "saved" | "unsaved" | "saving" | "error" | "conflict"

type Draft = { title: string; content: string }

/**
 * Saves an existing page shortly after typing stops. Every save is guarded by the page's
 * `version` (`where: { id, version }`): if someone else saved in between, the update matches no
 * row (NOT_FOUND), autosave stops, and nothing is overwritten.
 */
export function useWikiAutosave(page: WikiPageDetail, draft: Draft) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<SaveStatus>("saved")
  // the version this editor last wrote; a live refetch of `page` must not move it forward
  const version = useRef(page.version)
  const saved = useRef<Draft>({ title: page.title, content: page.content })
  // edits not yet captured by a revision (the opened content already has one)
  const sinceRevision = useRef(false)
  const lastRevisionAt = useRef(0)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const latest = useRef(draft)
  useEffect(() => {
    latest.current = draft
  })

  const write = useCallback(
    async (forceRevision: boolean): Promise<boolean> => {
      if (inFlight.current) await inFlight.current
      const { title, content } = latest.current
      const t = title.trim()
      const changed =
        t !== saved.current.title || content !== saved.current.content
      if (!t) return false
      if (!changed && !(forceRevision && sinceRevision.current)) return true
      const revision =
        forceRevision || Date.now() - lastRevisionAt.current > REVISION_EVERY_MS
      const run = (async () => {
        setStatus("saving")
        try {
          await db.wikiPage.update({
            where: { id: page.id, version: version.current },
            data: {
              title: t,
              content,
              version: { increment: 1 },
              ...(revision
                ? { revisions: { create: { title: t, content } } }
                : {}),
            },
            select: { id: true },
          })
          version.current += 1
          saved.current = { title: t, content }
          sinceRevision.current = !revision
          if (revision) lastRevisionAt.current = Date.now()
          const dirty =
            latest.current.title.trim() !== t ||
            latest.current.content !== content
          setStatus(dirty ? "unsaved" : "saved")
          void invalidateModels(qc, ["wikiPage", "wikiRevision"])
          return true
        } catch (err) {
          if (err instanceof ApiError && err.code === "NOT_FOUND") {
            setStatus("conflict")
            toast.error(i18n.t("wiki.editor.conflictToast"), {
              duration: 10_000,
            })
            void invalidateModels(qc, ["wikiPage", "wikiRevision"])
          } else {
            setStatus("error")
            toast.error(errorMessage(err))
          }
          return false
        } finally {
          inFlight.current = null
        }
      })()
      inFlight.current = run
      return run
    },
    [page.id, qc]
  )

  // debounce: every change restarts the timer
  useEffect(() => {
    if (status === "conflict") return
    const t = draft.title.trim()
    if (t === saved.current.title && draft.content === saved.current.content)
      return
    setStatus("unsaved")
    const timer = setTimeout(() => void write(false), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- status changes must not re-arm the timer
  }, [draft.title, draft.content, write])

  return {
    status,
    /** Save now with a history entry (⌘S, Done). Resolves false if it could not be saved. */
    flush: () => (status === "conflict" ? Promise.resolve(false) : write(true)),
  }
}
