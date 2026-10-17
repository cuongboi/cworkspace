import { cn } from "cn"
import { FileIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { fileUrl } from "@/lib/upload"

export type AttachmentLike = {
  id: string
  name: string
  mimeType: string
  size: number
  width?: number | null
  height?: number | null
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isImage = (a: AttachmentLike) => a.mimeType.startsWith("image/")

/** Image grid (click to enlarge) + file chips. `onRemove` turns it into an editable list. */
export function AttachmentList({
  attachments,
  onRemove,
  className,
}: {
  attachments: AttachmentLike[]
  onRemove?: (id: string) => void
  className?: string
}) {
  const [open, setOpen] = useState<AttachmentLike | null>(null)
  if (attachments.length === 0) return null
  const images = attachments.filter(isImage)
  const files = attachments.filter((a) => !isImage(a))

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {images.length > 0 ? (
        <div
          className={cn(
            "grid gap-1 overflow-hidden rounded-lg",
            images.length > 1 ? "grid-cols-2" : "grid-cols-1"
          )}
        >
          {images.slice(0, 4).map((img, i) => (
            <div key={img.id} className="group relative">
              <button
                type="button"
                className="block w-full"
                onClick={() => setOpen(img)}
                aria-label={`Open ${img.name}`}
              >
                {/* biome-ignore lint/performance/noImgElement: authenticated redirect URLs can't go through next/image */}
                <img
                  src={fileUrl(img.id)}
                  alt={img.name}
                  loading="lazy"
                  className={cn(
                    "w-full bg-muted object-cover",
                    images.length === 1 ? "max-h-[28rem]" : "aspect-square"
                  )}
                />
                {i === 3 && images.length > 4 ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">
                    +{images.length - 4}
                  </span>
                ) : null}
              </button>
              {onRemove ? (
                <RemoveButton onClick={() => onRemove(img.id)} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {files.map((f) => (
        <div
          key={f.id}
          className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2"
        >
          <FileIcon className="size-5 shrink-0 text-muted-foreground" />
          <a
            href={fileUrl(f.id, { download: true })}
            className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
          >
            {f.name}
          </a>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatBytes(f.size)}
          </span>
          {onRemove ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onRemove(f.id)}
              aria-label="Remove"
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ))}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-4xl p-2">
          <DialogTitle className="sr-only">{open?.name}</DialogTitle>
          {open ? (
            // biome-ignore lint/performance/noImgElement: see above
            <img
              src={fileUrl(open.id)}
              alt={open.name}
              className="max-h-[85vh] w-full rounded object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="secondary"
      size="icon"
      className="absolute top-1 right-1 size-7 rounded-full opacity-90"
      onClick={onClick}
      aria-label="Remove"
    >
      <XIcon />
    </Button>
  )
}
