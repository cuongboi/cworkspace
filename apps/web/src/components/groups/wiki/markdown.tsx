import { cn } from "cn"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { ScrollArea } from "@/components/ui/scroll-area"

/**
 * Markdown → React with GitHub-flavored extensions. Raw HTML is never rendered (react-markdown
 * escapes it by default and we add no rehype-raw), so page content can't inject markup or scripts.
 * Styled element by element: the app has no typography plugin.
 */
/** react-markdown passes its AST `node` to custom components: never spread it onto the DOM. */
function withoutNode<T extends { node?: unknown }>(props: T): Omit<T, "node"> {
  const rest = { ...props }
  delete rest.node
  return rest
}

const components: Components = {
  h1: (props) => (
    <h1
      className="mt-6 mb-3 text-2xl font-bold tracking-tight first:mt-0"
      {...withoutNode(props)}
    />
  ),
  h2: (props) => (
    <h2
      className="mt-6 mb-2 border-b pb-1 text-xl font-semibold first:mt-0"
      {...withoutNode(props)}
    />
  ),
  h3: (props) => (
    <h3
      className="mt-5 mb-2 text-lg font-semibold first:mt-0"
      {...withoutNode(props)}
    />
  ),
  h4: (props) => (
    <h4
      className="mt-4 mb-2 font-semibold first:mt-0"
      {...withoutNode(props)}
    />
  ),
  p: (props) => (
    <p className="my-3 leading-7 first:mt-0" {...withoutNode(props)} />
  ),
  a: (props) => (
    <a
      className="font-medium text-primary underline underline-offset-4"
      target="_blank"
      rel="noopener noreferrer nofollow"
      {...withoutNode(props)}
    />
  ),
  ul: (props) => (
    <ul className="my-3 ml-6 list-disc [&>li]:mt-1" {...withoutNode(props)} />
  ),
  ol: (props) => (
    <ol
      className="my-3 ml-6 list-decimal [&>li]:mt-1"
      {...withoutNode(props)}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="my-3 border-l-2 pl-4 text-muted-foreground italic"
      {...withoutNode(props)}
    />
  ),
  hr: () => <hr className="my-6" />,
  pre: (props) => (
    <ScrollArea
      orientation="horizontal"
      className="my-3 rounded-lg border bg-muted"
    >
      <pre
        className="p-3 font-mono text-sm [&>code]:bg-transparent [&>code]:p-0"
        {...withoutNode(props)}
      />
    </ScrollArea>
  ),
  code: ({ className, ...props }) => (
    <code
      className={cn(
        "rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]",
        className
      )}
      {...withoutNode(props)}
    />
  ),
  table: (props) => (
    <ScrollArea orientation="horizontal" className="my-4 w-full">
      <table
        className="w-full border-collapse text-sm"
        {...withoutNode(props)}
      />
    </ScrollArea>
  ),
  th: (props) => (
    <th
      className="border px-3 py-1.5 text-left font-semibold"
      {...withoutNode(props)}
    />
  ),
  td: (props) => <td className="border px-3 py-1.5" {...withoutNode(props)} />,
  img: ({ alt, ...props }) => (
    <img
      alt={alt ?? ""}
      className="my-3 max-w-full rounded-lg"
      {...withoutNode(props)}
    />
  ),
  input: (props) => (
    <input className="mr-1.5 align-middle" disabled {...withoutNode(props)} />
  ),
}

export function Markdown({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div className={cn("text-sm break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
