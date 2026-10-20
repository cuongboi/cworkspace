import { cn } from "cn"
import type { CaptionLang } from "@/lib/realtime-events"
import type { CaptionLine } from "@/lib/rtc/use-call"
import { useTranslation } from "react-i18next"

/**
 * One utterance for a reader of `lang`: the text in their language, with the original under it
 * when it was translated. Lines that won't get a translation (said before we joined, translating
 * failed) show the original as is.
 */
export function CaptionText({
  line,
  lang,
  className,
  originalClassName,
}: {
  line: CaptionLine
  lang: CaptionLang
  className?: string
  originalClassName?: string
}) {
  const { t } = useTranslation()
  const translated = line.sourceLang !== lang && !line.untranslated
  const main = translated ? line.translation : line.source
  return (
    <>
      {main?.text ? (
        <span className={cn(className, !main.final && "opacity-80")}>
          {main.text}
        </span>
      ) : (
        <span className={cn(className, "italic opacity-60")}>
          {line.source?.text ? t("call.captions.translating") : "…"}
        </span>
      )}
      {translated && line.source?.text ? (
        <span
          lang={line.sourceLang}
          className={cn("block text-[0.8em] opacity-60", originalClassName)}
        >
          {line.source.text}
        </span>
      ) : null}
    </>
  )
}
