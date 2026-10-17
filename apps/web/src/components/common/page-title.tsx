/** Sets the document title (React 19 hoists `<title>` into `<head>`). */
export function PageTitle({ title }: { title?: string }) {
  return <title>{title ? `${title} · cworkplace` : "cworkplace"}</title>
}
