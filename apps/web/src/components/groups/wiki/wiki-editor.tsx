import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, db } from "@/lib/api-client"
import { invalidateModels } from "@/lib/query"
import { Markdown } from "./markdown"
import type { WikiPageDetail } from "./wiki-query"

const MAX_TITLE = 200

type Props = {
  groupId: string
  /** edit this page; otherwise create a new one under `parentId` */
  page?: WikiPageDetail
  parentId?: string | null
  /** position of a new page among its siblings (appended) */
  position?: number
  onSaved: (pageId: string) => void
  onCancel: () => void
}

/**
 * Title + markdown body with a preview. Every save writes the page and a revision in one nested
 * write. Edits are guarded by the page's `version`: if someone saved in between, the update matches
 * no row (NOT_FOUND) and nothing is overwritten.
 */
export function WikiEditor({
  groupId,
  page,
  parentId = null,
  position = 0,
  onSaved,
  onCancel,
}: Props) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(page?.title ?? "")
  const [content, setContent] = useState(page?.content ?? "")
  // the version this edit started from: a live refetch of `page` must not move it forward
  const [baseVersion] = useState(page?.version ?? 0)
  const [saving, setSaving] = useState(false)
  const dirty =
    title !== (page?.title ?? "") || content !== (page?.content ?? "")

  const save = async () => {
    const t = title.trim()
    if (!t) return void toast.error("Give the page a title")
    if (page && !dirty) return onSaved(page.id)
    setSaving(true)
    try {
      const revision = { create: { title: t, content } }
      const saved = page
        ? await db.wikiPage.update({
            where: { id: page.id, version: baseVersion },
            data: {
              title: t,
              content,
              version: { increment: 1 },
              revisions: revision,
            },
            select: { id: true },
          })
        : await db.wikiPage.create({
            data: {
              groupId,
              parentId,
              position,
              title: t,
              content,
              revisions: revision,
            },
            select: { id: true },
          })
      await invalidateModels(qc, ["wikiPage", "wikiRevision"])
      toast.success(page ? "Page saved" : "Page created")
      onSaved(saved.id)
    } catch (err) {
      if (page && err instanceof ApiError && err.code === "NOT_FOUND") {
        await invalidateModels(qc, ["wikiPage", "wikiRevision"])
        toast.error(
          "Someone else saved this page since you opened it. Copy your changes, then reopen the editor."
        )
      } else {
        toast.error(err instanceof ApiError ? err.message : "Could not save")
      }
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    if (dirty && !window.confirm("Discard your changes?")) return
    onCancel()
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault()
          void save()
        }
      }}
    >
      <Input
        aria-label="Page title"
        placeholder="Page title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={MAX_TITLE}
        autoFocus={!page}
        className="h-11 text-lg font-semibold"
      />
      <Tabs defaultValue="write" className="gap-2">
        <TabsList>
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="write">
          <Textarea
            aria-label="Page content (Markdown)"
            placeholder="Write in Markdown: # Heading, **bold**, - list, [link](https://…), | tables |"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-96 font-mono text-sm"
          />
        </TabsContent>
        <TabsContent value="preview">
          <div className="min-h-96 rounded-lg border p-4">
            {content.trim() ? (
              <Markdown>{content}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing to preview
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          Markdown supported · ⌘/Ctrl+S to save
        </span>
        <Button type="button" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !title.trim()}>
          {saving ? <Spinner /> : null}
          {page ? "Save" : "Create page"}
        </Button>
      </div>
    </form>
  )
}
