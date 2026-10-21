import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Document, Page, pdfjs } from "react-pdf"
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { Skeleton } from "@/components/ui/skeleton"

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

/** Every page, fitted to the container width (lazy-loaded: pdf.js is large). */
export default function PdfDocument({ file }: { file: Blob }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [pages, setPages] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width))
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className="w-full">
      <Document
        file={file}
        onLoadSuccess={(pdf) => setPages(pdf.numPages)}
        loading={<Skeleton className="aspect-[1/1.414] w-full" />}
        error={
          <p className="py-12 text-center text-sm text-muted-foreground">
            {t("common.documentViewer.loadFailed")}
          </p>
        }
        className="flex flex-col items-center gap-4"
      >
        {width > 0
          ? Array.from({ length: pages }, (_, i) => (
              <Page
                key={i}
                pageNumber={i + 1}
                width={width}
                className="overflow-hidden rounded-md border bg-white"
                loading={<Skeleton className="aspect-[1/1.414] w-full" />}
              />
            ))
          : null}
      </Document>
    </div>
  )
}
