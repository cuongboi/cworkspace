import { useEditorState, type Editor } from "@tiptap/react"
import {
  BoldIcon,
  CheckSquareIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  TableIcon,
  type LucideIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Separator } from "@/components/ui/separator"
import { Toggle } from "@/components/ui/toggle"
import i18n from "@/lib/i18n"

type ToolKey =
  | "bold"
  | "italic"
  | "strike"
  | "inlineCode"
  | "link"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "codeBlock"
  | "table"

type Item = {
  /** i18n key under `wiki.toolbar` */
  label: ToolKey
  icon: LucideIcon
  active?: (e: Editor) => boolean
  run: (e: Editor) => void
}

const GROUPS: Item[][] = [
  [
    {
      label: "bold",
      icon: BoldIcon,
      active: (e) => e.isActive("bold"),
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      label: "italic",
      icon: ItalicIcon,
      active: (e) => e.isActive("italic"),
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      label: "strike",
      icon: StrikethroughIcon,
      active: (e) => e.isActive("strike"),
      run: (e) => e.chain().focus().toggleStrike().run(),
    },
    {
      label: "inlineCode",
      icon: CodeIcon,
      active: (e) => e.isActive("code"),
      run: (e) => e.chain().focus().toggleCode().run(),
    },
    {
      label: "link",
      icon: LinkIcon,
      active: (e) => e.isActive("link"),
      run: (e) => {
        if (e.isActive("link")) return void e.chain().focus().unsetLink().run()
        const href = window.prompt(i18n.t("wiki.toolbar.linkPrompt"))?.trim()
        if (href)
          e.chain().focus().extendMarkRange("link").setLink({ href }).run()
      },
    },
  ],
  [
    {
      label: "h2",
      icon: Heading2Icon,
      active: (e) => e.isActive("heading", { level: 2 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "h3",
      icon: Heading3Icon,
      active: (e) => e.isActive("heading", { level: 3 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
  ],
  [
    {
      label: "bullet",
      icon: ListIcon,
      active: (e) => e.isActive("bulletList"),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      label: "ordered",
      icon: ListOrderedIcon,
      active: (e) => e.isActive("orderedList"),
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "task",
      icon: CheckSquareIcon,
      active: (e) => e.isActive("taskList"),
      run: (e) => e.chain().focus().toggleTaskList().run(),
    },
  ],
  [
    {
      label: "quote",
      icon: QuoteIcon,
      active: (e) => e.isActive("blockquote"),
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "codeBlock",
      icon: SquareCodeIcon,
      active: (e) => e.isActive("codeBlock"),
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "table",
      icon: TableIcon,
      run: (e) =>
        e
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
  ],
]

export function EditorToolbar({
  editor,
  onPickImage,
}: {
  editor: Editor
  onPickImage: () => void
}) {
  const { t } = useTranslation()
  // re-render only when the active marks/nodes change, not on every keystroke
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      GROUPS.flat().map((item) => item.active?.(editor) ?? false),
  })
  let i = 0
  return (
    <div
      role="toolbar"
      aria-label={t("wiki.toolbar.formatting")}
      className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-lg border-b bg-card p-1"
    >
      {GROUPS.map((group, g) => (
        <div key={g} className="flex items-center gap-0.5">
          {g ? <Separator orientation="vertical" className="mx-1 h-5" /> : null}
          {group.map((item) => {
            const pressed = active[i++] ?? false
            return (
              <Toggle
                key={item.label}
                size="sm"
                aria-label={t(`wiki.toolbar.${item.label}`)}
                title={t(`wiki.toolbar.${item.label}`)}
                pressed={pressed}
                onPressedChange={() => item.run(editor)}
              >
                <item.icon />
              </Toggle>
            )
          })}
        </div>
      ))}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Toggle
        size="sm"
        aria-label={t("wiki.toolbar.image")}
        title={t("wiki.toolbar.image")}
        pressed={false}
        onPressedChange={onPickImage}
      >
        <ImageIcon />
      </Toggle>
    </div>
  )
}
