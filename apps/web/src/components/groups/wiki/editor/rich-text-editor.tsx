import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import { cn } from "cn"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { errorMessage } from "@/lib/i18n"
import { fileUrl, uploadFile, type UploadedAttachment } from "@/lib/upload"
import { blockLabel, filterCommands, type BlockCommand } from "./commands"
import { EditorToolbar } from "./editor-toolbar"
import { wikiExtensions } from "./extensions"

type Props = {
  /** initial Markdown; later changes from outside are applied only through `key` */
  markdown: string
  onChange: (markdown: string) => void
  /** the page images are attached to (absent while a new page is being written) */
  wikiPageId?: string
  onUploaded?: (file: UploadedAttachment) => void
  className?: string
}

type Slash = {
  query: string
  from: number
  left: number
  top: number
  index: number
}

/** `/word` typed at the start of an empty-ish block opens the block menu. */
function slashAt(editor: Editor) {
  const { selection } = editor.state
  if (!selection.empty) return null
  const { $from } = selection
  if ($from.parent.type.name === "codeBlock") return null
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, " ")
  const match = /^\/(\w{0,20})$/.exec(before)
  if (!match) return null
  const coords = editor.view.coordsAtPos(selection.from)
  return {
    query: match[1],
    from: selection.from - before.length,
    left: coords.left,
    top: coords.bottom,
  }
}

/**
 * Tiptap editor that reads and writes Markdown. Images pasted or dropped are uploaded and
 * embedded as `![name](/api/files/:id)`; `/` opens the block menu.
 */
export function RichTextEditor({
  markdown,
  onChange,
  wikiPageId,
  onUploaded,
  className,
}: Props) {
  const { t } = useTranslation()
  const [slash, setSlash] = useState<Slash | null>(null)
  const slashRef = useRef(slash)
  const fileInput = useRef<HTMLInputElement>(null)
  // handlers read the latest props without re-creating the editor
  const latest = useRef({ onChange, wikiPageId, onUploaded })
  useEffect(() => {
    latest.current = { onChange, wikiPageId, onUploaded }
    slashRef.current = slash
  })

  const uploadImages = async (editor: Editor, files: File[], pos?: number) => {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue
      const id = toast.loading(t("wiki.editor.uploading", { name: file.name }))
      try {
        const uploaded = await uploadFile(file, {
          wikiPageId: latest.current.wikiPageId,
        })
        latest.current.onUploaded?.(uploaded)
        const image = {
          type: "image",
          attrs: { src: fileUrl(uploaded.id), alt: uploaded.name },
        }
        const chain = editor.chain().focus()
        ;(pos == null
          ? chain.insertContent(image)
          : chain.insertContentAt(pos, image)
        ).run()
        toast.dismiss(id)
      } catch (err) {
        toast.error(errorMessage(err), { id })
      }
    }
  }

  const editor = useEditor({
    extensions: wikiExtensions(t("wiki.editor.richPlaceholder")),
    content: markdown,
    contentType: "markdown",
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class:
          "wiki-prose min-h-96 px-4 py-3 text-sm outline-none [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (
          !files.some((f) => f.type.startsWith("image/")) ||
          !editorRef.current
        )
          return false
        event.preventDefault()
        void uploadImages(editorRef.current, files)
        return true
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (
          !files.some((f) => f.type.startsWith("image/")) ||
          !editorRef.current
        )
          return false
        event.preventDefault()
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos
        void uploadImages(editorRef.current, files, pos)
        return true
      },
      handleKeyDown: (_view, event) => {
        const open = slashRef.current
        if (!open) return false
        const items = filterCommands(open.query)
        if (event.key === "Escape") {
          setSlash(null)
          return true
        }
        if (!items.length) return false
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const step = event.key === "ArrowDown" ? 1 : -1
          setSlash({
            ...open,
            index: (open.index + step + items.length) % items.length,
          })
          return true
        }
        if (event.key === "Enter" || event.key === "Tab") {
          runCommand(items[open.index] ?? items[0])
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      latest.current.onChange(editor.getMarkdown())
      trackSlash(editor)
    },
    onSelectionUpdate: ({ editor }) => trackSlash(editor),
    onBlur: () => setSlash(null),
  })
  const editorRef = useRef<Editor | null>(null)
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  function trackSlash(editor: Editor) {
    const hit = slashAt(editor)
    setSlash((prev) =>
      hit ? { ...hit, index: prev?.query === hit.query ? prev.index : 0 } : null
    )
  }

  function runCommand(command: BlockCommand | undefined) {
    const open = slashRef.current
    const editor = editorRef.current
    if (!editor || !command || !open) return
    editor
      .chain()
      .focus()
      .deleteRange({ from: open.from, to: editor.state.selection.from })
      .run()
    setSlash(null)
    command.run(editor, { pickImage: () => fileInput.current?.click() })
  }

  const items = slash ? filterCommands(slash.query) : []

  return (
    <div className={cn("relative rounded-lg border", className)}>
      {editor ? (
        <EditorToolbar
          editor={editor}
          onPickImage={() => fileInput.current?.click()}
        />
      ) : null}
      <EditorContent editor={editor} />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          if (editor) void uploadImages(editor, files)
        }}
      />
      {slash && items.length ? (
        <div
          role="listbox"
          aria-label={t("wiki.editor.insertBlock")}
          className="fixed z-50 max-h-72 w-60 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground"
          style={{ left: slash.left, top: slash.top + 4 }}
        >
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={i === slash.index}
              // keep the editor focused (and the slash range intact) while clicking
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runCommand(item)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                i === slash.index && "bg-accent"
              )}
            >
              <item.icon className="size-4 text-muted-foreground" />
              {blockLabel(item)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
