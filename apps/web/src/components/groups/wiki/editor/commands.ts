import type { Editor } from "@tiptap/react"
import {
  CheckSquareIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  TableIcon,
  type LucideIcon,
} from "lucide-react"
import i18n from "@/lib/i18n"

export type BlockCommand = {
  id: string
  label: string
  keywords: string
  icon: LucideIcon
  run: (editor: Editor, ctx: { pickImage: () => void }) => void
}

/** Block types offered by the `/` menu and the toolbar's insert menu. */
export const BLOCK_COMMANDS: BlockCommand[] = [
  {
    id: "h1",
    label: "Heading 1",
    keywords: "title h1",
    icon: Heading1Icon,
    run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    keywords: "subtitle h2",
    icon: Heading2Icon,
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "Heading 3",
    keywords: "h3",
    icon: Heading3Icon,
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    label: "Bulleted list",
    keywords: "ul unordered",
    icon: ListIcon,
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered",
    label: "Numbered list",
    keywords: "ol ordered",
    icon: ListOrderedIcon,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "task",
    label: "To-do list",
    keywords: "task checkbox check",
    icon: CheckSquareIcon,
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: "code",
    label: "Code block",
    keywords: "snippet pre",
    icon: CodeIcon,
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "quote",
    label: "Quote",
    keywords: "blockquote",
    icon: QuoteIcon,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "table",
    label: "Table",
    keywords: "grid",
    icon: TableIcon,
    run: (e) =>
      e
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    id: "divider",
    label: "Divider",
    keywords: "hr rule line",
    icon: MinusIcon,
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "image",
    label: "Image",
    keywords: "picture photo upload",
    icon: ImageIcon,
    run: (_e, ctx) => ctx.pickImage(),
  },
]

export function filterCommands(query: string) {
  const q = query.toLowerCase()
  return BLOCK_COMMANDS.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      blockLabel(c).toLowerCase().includes(q) ||
      c.keywords.includes(q)
  )
}

/** The label shown in the UI; the English `label` stays searchable in every language. */
export function blockLabel(c: BlockCommand) {
  return i18n.t(`wiki.blocks.${c.id as BlockId}`)
}

type BlockId =
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "task"
  | "code"
  | "quote"
  | "table"
  | "divider"
  | "image"
