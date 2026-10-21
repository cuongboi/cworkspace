import { cn } from "cn"
import { FileTextIcon, GlobeIcon, PlayIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Skeleton } from "@/components/ui/skeleton"
import {
  extractLinks,
  type LinkPreview,
  shortUrl,
  useLinkPreview,
} from "@/lib/link-preview"
import { ImageLightbox } from "./image-lightbox"
import {
  DocumentViewerDialog,
  isViewable,
  urlFileName,
  useDocument,
  ViewDocumentButton,
} from "./document-viewer"
import { AudioPlayer, VideoPlayer } from "./video-attachment"

/** Rich previews for the first `max` URLs in user text (media inline, embeds, page cards). */
export function LinkPreviews({
  text,
  max = 3,
  className,
}: {
  text: string
  max?: number
  className?: string
}) {
  const urls = extractLinks(text, max)
  if (urls.length === 0) return null
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {urls.map((url) =>
        isViewable(url) ? (
          <DocumentLinkCard key={url} url={url} />
        ) : (
          <LinkPreviewItem key={url} url={url} />
        )
      )}
    </div>
  )
}

function LinkPreviewItem({ url }: { url: string }) {
  const { preview, loading } = useLinkPreview(url)
  // a guessed image/video that fails to load just disappears (the link text stays)
  const [broken, setBroken] = useState(false)
  if (loading) return <Skeleton className="h-24 w-full rounded-xl" />
  if (!preview || broken) return null
  return <PreviewBody preview={preview} onBroken={() => setBroken(true)} />
}

function PreviewBody({
  preview,
  onBroken,
}: {
  preview: LinkPreview
  onBroken: () => void
}) {
  switch (preview.type) {
    case "image":
      return <LinkedImage url={preview.url} onBroken={onBroken} />
    case "video":
      return <VideoPlayer src={preview.url} mimeType={preview.mimeType} />
    case "audio":
      return <AudioPlayer src={preview.url} mimeType={preview.mimeType} />
    case "embed":
      return <EmbedPlayer preview={preview} />
    case "page":
      return <PageCard preview={preview} />
    default:
      return null
  }
}

function LinkedImage({ url, onBroken }: { url: string; onBroken: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="block w-fit max-w-full overflow-hidden rounded-lg"
        onClick={() => setOpen(true)}
        aria-label={t("common.linkPreview.openImage")}
      >
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={onBroken}
          className="max-h-112 bg-muted object-contain"
        />
      </button>
      <ImageLightbox
        src={open ? url : null}
        alt={url}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

/**
 * Click-to-load: nothing from the provider is loaded until the viewer opts in (feed stays fast,
 * no third-party tracking on scroll). `matchEmbed` builds the iframe src from a validated id, so
 * only allow-listed origins are ever framed.
 */
function EmbedPlayer({
  preview,
}: {
  preview: Extract<LinkPreview, { type: "embed" }>
}) {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(false)
  return (
    <div className="relative aspect-video w-full max-w-xl overflow-hidden rounded-lg border bg-black">
      {playing ? (
        <iframe
          src={preview.embedUrl}
          title={preview.title ?? preview.provider}
          className="absolute inset-0 size-full"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button
          type="button"
          className="group absolute inset-0 flex items-center justify-center"
          onClick={() => setPlaying(true)}
          aria-label={t("common.linkPreview.play")}
        >
          {preview.thumbnail ? (
            <img
              src={preview.thumbnail}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="absolute inset-0 size-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
            />
          ) : null}
          <span className="relative flex size-14 items-center justify-center rounded-full bg-black/70 text-white transition-transform group-hover:scale-105">
            <PlayIcon className="ml-0.5 size-6 fill-current" />
          </span>
        </button>
      )}
    </div>
  )
}

function PageCard({
  preview,
}: {
  preview: Extract<LinkPreview, { type: "page" }>
}) {
  const [imageOk, setImageOk] = useState(true)
  const [faviconOk, setFaviconOk] = useState(true)
  const host = shortUrl(preview.url).split("/")[0]
  const image = preview.image && imageOk ? preview.image : null
  const banner = image && preview.imageLayout === "banner"
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        "flex max-w-xl overflow-hidden rounded-xl border bg-card transition-colors hover:bg-muted/50",
        banner ? "flex-col" : "flex-row"
      )}
      style={
        preview.themeColor
          ? { borderLeftColor: preview.themeColor, borderLeftWidth: 3 }
          : undefined
      }
    >
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageOk(false)}
          className={cn(
            "shrink-0 bg-muted object-cover",
            banner ? "aspect-[1.91/1] w-full border-b" : "size-24 border-r"
          )}
        />
      ) : null}
      <span className="flex min-w-0 flex-col gap-0.5 p-3">
        <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          {preview.favicon && faviconOk ? (
            <img
              src={preview.favicon}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setFaviconOk(false)}
              className="size-3.5 rounded-sm"
            />
          ) : (
            <GlobeIcon className="size-3.5" />
          )}
          <span className="truncate">{preview.siteName ?? host}</span>
        </span>
        <span className="line-clamp-2 text-sm font-semibold">
          {preview.title}
        </span>
        {preview.description ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {preview.description}
          </span>
        ) : null}
      </span>
    </a>
  )
}

/** Links to viewable documents (.md, .pdf, .csv, …) open in the viewer instead of a page card. */
function DocumentLinkCard({ url }: { url: string }) {
  const [open, setOpen] = useState(false)
  const name = urlFileName(url)
  const source = useMemo(
    () => (open ? ({ kind: "url", url } as const) : null),
    [open, url]
  )
  const loading = useDocument(source).query.isLoading
  return (
    <div className="flex items-center gap-3 rounded-md border bg-card p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <FileTextIcon className="size-4 text-muted-foreground" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-semibold">{name}</span>
        <span className="truncate text-2xs text-muted-foreground">
          {shortUrl(url)}
        </span>
      </span>
      <ViewDocumentButton loading={loading} onClick={() => setOpen(true)} />
      <DocumentViewerDialog source={source} onClose={() => setOpen(false)} />
    </div>
  )
}
