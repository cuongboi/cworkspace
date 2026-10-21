import { cn } from "cn"
import { File, XIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { fileUrl } from "@/lib/upload"
import { ImageLightbox } from "./image-lightbox"
import {
  type DocumentSource,
  DocumentViewerDialog,
  isViewable,
  useDocument,
  ViewDocumentButton,
} from "./document-viewer"
import { VideoAttachment } from "./video-attachment"

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

/** "PDF", "ZIP", … from the file name, falling back to the mime subtype. */
export function fileKind(f: Pick<AttachmentLike, "name" | "mimeType">) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(f.name)?.[1]
  return (ext ?? f.mimeType.split("/")[1] ?? "file").toUpperCase()
}

const isImage = (a: AttachmentLike) => a.mimeType.startsWith("image/")
const isVideo = (a: AttachmentLike) => a.mimeType.startsWith("video/")

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
  const { t } = useTranslation()
  const [open, setOpen] = useState<AttachmentLike | null>(null)
  const [doc, setDoc] = useState<DocumentSource | null>(null)
  const docLoading = useDocument(doc).query.isLoading
  if (attachments.length === 0) return null
  const images = attachments.filter(isImage)
  const videos = attachments.filter(isVideo)
  const files = attachments.filter((a) => !isImage(a) && !isVideo(a))

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
                aria-label={t("feed.attachments.open", { name: img.name })}
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
      {videos.map((v) => (
        <div key={v.id} className="group relative">
          <VideoAttachment attachment={v} />
          {onRemove ? <RemoveButton onClick={() => onRemove(v.id)} /> : null}
        </div>
      ))}
      {files.map((f) => (
        <div
          key={f.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-card p-3 sm:flex-nowrap"
        >
          <FileTypeIcon label={fileKind(f)} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-semibold">{f.name}</span>
            <span className="truncate text-2xs text-muted-foreground">
              {formatBytes(f.size)}
              {f.mimeType ? ` · ${fileKind(f)}` : ""}
            </span>
          </span>
          {onRemove ? null : (
            <div className="flex w-full gap-2 sm:w-auto">
              {isViewable(f.name) ? (
                <ViewDocumentButton
                  className="flex-1 sm:flex-none"
                  loading={
                    docLoading && doc?.kind === "file" && doc.id === f.id
                  }
                  onClick={() =>
                    setDoc({ kind: "file", id: f.id, name: f.name })
                  }
                />
              ) : null}
              <Button
                asChild
                variant="outline"
                size="xs"
                className="flex-1 sm:flex-none"
              >
                <a href={fileUrl(f.id, { download: true })}>
                  {t("feed.attachments.download")}
                </a>
              </Button>
            </div>
          )}
          {onRemove ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onRemove(f.id)}
              aria-label={t("common.remove")}
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      ))}
      <ImageLightbox
        src={open ? fileUrl(open.id) : null}
        alt={open?.name ?? ""}
        onClose={() => setOpen(null)}
      />
      <DocumentViewerDialog source={doc} onClose={() => setDoc(null)} />
    </div>
  )
}

/** Lucide file outline with the extension printed inside; font shrinks for longer labels. */
export function FileTypeIcon({
  label,
  className,
}: {
  label: string
  className?: string
}) {
  const text = label.slice(0, 4)
  const fontSize = text.length <= 2 ? 7 : text.length === 3 ? 5.5 : 4.5
  return (
    <File
      className={cn("size-8 shrink-0 text-muted-foreground", className)}
      aria-hidden
    >
      <text
        x={12}
        y={18.5}
        textAnchor="middle"
        fontSize={fontSize}
        fontFamily="Verdana,sans-serif"
        fontWeight={700}
        strokeWidth={0}
        fill="currentColor"
      >
        {text}
      </text>
    </File>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <Button
      variant="secondary"
      size="icon"
      className="absolute top-1 right-1 size-7 rounded-full opacity-90"
      onClick={onClick}
      aria-label={t("common.remove")}
    >
      <XIcon />
    </Button>
  )
}
