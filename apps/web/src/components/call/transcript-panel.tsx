import { format } from "date-fns"
import i18n from "@/lib/i18n"
import { DownloadIcon, XIcon } from "lucide-react"
import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import type { CaptionLang } from "@/lib/realtime-events"
import type { CaptionLine } from "@/lib/rtc/use-call"
import { CaptionText } from "./caption-text"
import { useTranslation } from "react-i18next"

/** Text of a line for a reader of `lang`, with the original when it was translated. */
function lineText(line: CaptionLine, lang: CaptionLang) {
  const original = line.source?.text ?? ""
  if (line.sourceLang === lang || line.untranslated || !line.translation)
    return original
  return original
    ? `${line.translation.text}\n    (${original})`
    : line.translation.text
}

/** Saves the transcript as a .txt file (it only exists in this browser and on the server's memory). */
function downloadTranscript(
  lines: CaptionLine[],
  lang: CaptionLang,
  title: string | null
) {
  const header = `${title ?? i18n.t("call.title")} (${format(lines[0]?.startedAt ?? Date.now(), "yyyy-MM-dd HH:mm")})`
  const body = lines
    .map(
      (l) =>
        `[${format(l.startedAt, "HH:mm:ss")}] ${l.user.name}: ${lineText(l, lang)}`
    )
    .join("\n")
  const url = URL.createObjectURL(
    new Blob([`${header}\n\n${body}\n`], { type: "text/plain;charset=utf-8" })
  )
  const a = document.createElement("a")
  a.href = url
  a.download = `transcript-${format(lines[0]?.startedAt ?? Date.now(), "yyyyMMdd-HHmm")}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

/** Every final caption line of the call: a side panel on desktop, a sheet on mobile. */
export function TranscriptPanel({
  lines,
  lang,
  title,
  open,
  onClose,
}: {
  lines: CaptionLine[]
  lang: CaptionLang
  title: string | null
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const body = (
    <TranscriptBody
      lines={lines}
      lang={lang}
      onClose={onClose}
      onDownload={() => downloadTranscript(lines, lang, title)}
    />
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="dark gap-0 bg-background p-0 text-foreground data-[side=bottom]:h-[80svh]"
        >
          <SheetTitle className="sr-only">
            {t("call.transcript.title")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("call.transcript.description")}
          </SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    )
  }
  if (!open) return null
  return (
    <aside
      aria-label={t("call.transcript.title")}
      className="flex w-80 shrink-0 flex-col border-l lg:w-96"
    >
      {body}
    </aside>
  )
}

function TranscriptBody({
  lines,
  lang,
  onClose,
  onDownload,
}: {
  lines: CaptionLine[]
  lang: CaptionLang
  onClose: () => void
  onDownload: () => void
}) {
  const { t } = useTranslation()
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [lines.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-sm font-medium">{t("call.transcript.title")}</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("call.transcript.download")}
            disabled={!lines.length}
            onClick={onDownload}
          >
            <DownloadIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("call.transcript.close")}
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        {lines.length ? (
          <ol className="flex flex-col gap-3 p-4">
            {lines.map((line) => (
              <li key={line.id} className="text-sm">
                <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {line.user.name}
                  </span>
                  {format(line.startedAt, "HH:mm:ss")}
                </div>
                <p className="leading-relaxed">
                  <CaptionText
                    line={line}
                    lang={lang}
                    originalClassName="mt-0.5"
                  />
                </p>
              </li>
            ))}
            <div ref={end} />
          </ol>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {t("call.transcript.empty")}
          </p>
        )}
      </ScrollArea>
    </div>
  )
}
