import { useQueryClient } from "@tanstack/react-query"
import { cn } from "cn"
import { CheckIcon, CloudAlertIcon, CloudIcon } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { db } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { invalidateModels } from "@/lib/query"
import { RichTextEditor } from "./editor/rich-text-editor"
import { Markdown } from "./markdown"
import { useWikiAutosave, type SaveStatus } from "./use-wiki-autosave"
import type { WikiPageDetail } from "./wiki-query"
import { WIKI_TEMPLATES } from "./wiki-templates"

type TemplateId = "blank" | "meeting" | "spec" | "runbook" | "howto"

const MAX_TITLE = 200

type Mode = "write" | "markdown" | "preview"

/**
 * Title + body, edited rich (Tiptap) or as raw Markdown, with a preview. Both modes edit the same
 * Markdown string, which is what gets stored.
 */
function Body({
  content,
  setContent,
  wikiPageId,
  onUploaded,
}: {
  content: string
  setContent: (value: string) => void
  wikiPageId?: string
  onUploaded?: (id: string) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>("write")
  // remount the rich editor after Markdown edits so it picks up the new source
  const [richKey, setRichKey] = useState(0)
  return (
    <Tabs
      value={mode}
      onValueChange={(next) => {
        if (next === "write" && mode === "markdown") setRichKey((k) => k + 1)
        setMode(next as Mode)
      }}
      className="gap-2"
    >
      <TabsList>
        <TabsTrigger value="write">{t("wiki.editor.write")}</TabsTrigger>
        <TabsTrigger value="markdown">Markdown</TabsTrigger>
        <TabsTrigger value="preview">{t("wiki.editor.preview")}</TabsTrigger>
      </TabsList>
      <TabsContent value="write">
        <RichTextEditor
          key={richKey}
          markdown={content}
          onChange={setContent}
          wikiPageId={wikiPageId}
          onUploaded={(file) => onUploaded?.(file.id)}
        />
      </TabsContent>
      <TabsContent value="markdown">
        <Textarea
          aria-label={t("wiki.editor.markdownLabel")}
          placeholder={t("wiki.editor.markdownPlaceholder")}
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
              {t("wiki.editor.nothingToPreview")}
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  )
}

function TitleInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Input
      aria-label={t("wiki.editor.pageTitle")}
      placeholder={t("wiki.editor.pageTitle")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={MAX_TITLE}
      autoFocus={autoFocus}
      className="h-11 text-lg font-semibold"
    />
  )
}

const STATUS: Record<SaveStatus, { icon: ReactNode }> = {
  saved: { icon: <CheckIcon className="size-3.5" /> },
  unsaved: {
    icon: <CloudIcon className="size-3.5" />,
  },
  saving: { icon: <Spinner className="size-3.5" /> },
  error: {
    icon: <CloudAlertIcon className="size-3.5" />,
  },
  conflict: {
    icon: <CloudAlertIcon className="size-3.5" />,
  },
}

/** Edits an existing page: autosaved, guarded by the page's version (see `useWikiAutosave`). */
export function WikiEditor({
  page,
  onDone,
}: {
  page: WikiPageDetail
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(page.title)
  const [content, setContent] = useState(page.content)
  const { status, flush } = useWikiAutosave(page, { title, content })
  const [closing, setClosing] = useState(false)
  const conflict = status === "conflict"

  const done = async () => {
    if (!title.trim()) return void toast.error(t("wiki.editor.needTitle"))
    setClosing(true)
    const ok = await flush()
    setClosing(false)
    if (ok) onDone()
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void done()
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault()
          void flush()
        }
      }}
    >
      <TitleInput value={title} onChange={setTitle} />
      <Body content={content} setContent={setContent} wikiPageId={page.id} />
      <div className="flex items-center justify-end gap-2">
        <span
          className={cn(
            "mr-auto flex items-center gap-1.5 text-xs text-muted-foreground",
            (conflict || status === "error") && "text-destructive"
          )}
          aria-live="polite"
        >
          {STATUS[status].icon}
          {t(`wiki.editor.status.${status}`)} · {t("wiki.editor.saveHint")}
        </span>
        {conflict ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              window.confirm(t("wiki.editor.confirmLeave")) && onDone()
            }
          >
            {t("wiki.editor.discard")}
          </Button>
        ) : null}
        <Button type="submit" disabled={closing || conflict}>
          {closing ? <Spinner /> : null}
          {t("common.done")}
        </Button>
      </div>
    </form>
  )
}

/** Writes a new page (from a template) under `parentId`; created in one nested write. */
export function NewWikiPage({
  groupId,
  parentId,
  position,
  onCreated,
  onCancel,
}: {
  groupId: string
  parentId: string | null
  /** position among its siblings (appended) */
  position: number
  onCreated: (pageId: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [template, setTemplate] = useState("blank")
  // remount the body when a template replaces the content
  const [bodyKey, setBodyKey] = useState(0)
  // images uploaded before the page existed: linked to it on create
  const uploads = useRef<string[]>([])
  const [saving, setSaving] = useState(false)
  const dirty = title.trim() !== "" || content.trim() !== ""

  const pickTemplate = (id: string) => {
    const tpl = WIKI_TEMPLATES.find((x) => x.id === id)
    if (!tpl || id === template) return
    if (content.trim() && !window.confirm(t("wiki.editor.confirmReplace")))
      return
    setTemplate(id)
    setContent(tpl.content)
    if (
      !title.trim() ||
      WIKI_TEMPLATES.some((x) => templateTitle(x.id) === title)
    )
      setTitle(templateTitle(tpl.id))
    setBodyKey((k) => k + 1)
  }

  const templateTitle = (id: string) =>
    id === "blank" ? "" : t(`wiki.templates.${id as TemplateId}.title`)

  const create = async () => {
    const pageTitle = title.trim()
    if (!pageTitle) return void toast.error(t("wiki.editor.needTitle"))
    setSaving(true)
    try {
      const page = await db.wikiPage.create({
        data: {
          groupId,
          parentId,
          position,
          title: pageTitle,
          content,
          revisions: { create: { title: pageTitle, content } },
          ...(uploads.current.length
            ? {
                attachments: {
                  connect: uploads.current.map((id) => ({ id })),
                },
              }
            : {}),
        },
        select: { id: true },
      })
      await invalidateModels(qc, ["wikiPage", "wikiRevision"])
      toast.success(t("wiki.editor.created"))
      onCreated(page.id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault()
          void create()
        }
      }}
    >
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label={t("wiki.editor.template")}
      >
        {WIKI_TEMPLATES.map((tpl) => (
          <Button
            key={tpl.id}
            type="button"
            size="sm"
            variant={tpl.id === template ? "secondary" : "outline"}
            role="radio"
            aria-checked={tpl.id === template}
            onClick={() => pickTemplate(tpl.id)}
          >
            {t(`wiki.templates.${tpl.id as TemplateId}.label`)}
          </Button>
        ))}
      </div>
      <TitleInput value={title} onChange={setTitle} autoFocus />
      <Body
        key={bodyKey}
        content={content}
        setContent={setContent}
        onUploaded={(id) => uploads.current.push(id)}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {t("wiki.editor.newHint")}
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            (!dirty || window.confirm(t("wiki.editor.confirmDiscard"))) &&
            onCancel()
          }
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={saving || !title.trim()}>
          {saving ? <Spinner /> : null}
          {t("wiki.editor.createPage")}
        </Button>
      </div>
    </form>
  )
}
