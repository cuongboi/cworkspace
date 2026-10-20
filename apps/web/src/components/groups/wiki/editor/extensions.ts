import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight"
import { Image } from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import { Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import { StarterKit } from "@tiptap/starter-kit"
import { common, createLowlight } from "lowlight"

const lowlight = createLowlight(common)

/**
 * Only nodes that survive a Markdown round trip (`@tiptap/markdown` out, `remark-gfm` in the
 * reader): pages are stored as Markdown, so anything else would be lost on the next save.
 */
export function wikiExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      codeBlock: false,
      // no Markdown syntax for underline
      underline: false,
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ allowBase64: false }),
    Placeholder.configure({ placeholder }),
    Markdown,
  ]
}
