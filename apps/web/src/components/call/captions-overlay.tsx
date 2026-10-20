import type { CaptionLang } from "@/lib/realtime-events"
import type { CaptionLine } from "@/lib/rtc/use-call"
import { CaptionText } from "./caption-text"
import { useTranslation } from "react-i18next"

/** The latest utterances over the call, in the reader's language (original underneath). */
export function CaptionsOverlay({
  lines,
  lang,
}: {
  lines: CaptionLine[]
  lang: CaptionLang
}) {
  const { t } = useTranslation()
  if (!lines.length) return null
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-4 z-10 mx-auto flex w-fit max-w-[min(48rem,calc(100%-2rem))] flex-col gap-2 rounded-xl bg-black/75 px-4 py-2 text-white"
    >
      {lines.map((line) => (
        <p key={line.id} className="text-base leading-snug md:text-lg">
          <span className="mr-2 font-medium text-white/60">
            {line.self ? t("call.captions.you") : line.user.name}
          </span>
          <CaptionText line={line} lang={lang} />
        </p>
      ))}
    </div>
  )
}
