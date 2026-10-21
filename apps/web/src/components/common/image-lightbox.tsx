import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

/** Full-size image in a dialog; `src === null` closes it. */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string | null
  alt: string
  onClose: () => void
}) {
  return (
    <Dialog open={src !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-2">
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        {src ? (
          <img
            src={src}
            alt={alt}
            referrerPolicy="no-referrer"
            className="max-h-[85vh] w-full rounded object-contain"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
