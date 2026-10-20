import type { Locale } from "date-fns"
import { enUS, ja as jaDate, vi as viDate } from "date-fns/locale"
import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next, useTranslation } from "react-i18next"
import { ApiError } from "@/lib/api-client"
import { en } from "@/locales/en"
import { ja } from "@/locales/ja"
import { vi } from "@/locales/vi"

export const LANGUAGES = [
  { code: "ja", label: "日本語" },
  { code: "en", label: "English" },
  { code: "vi", label: "Tiếng Việt" },
] as const
export type Language = (typeof LANGUAGES)[number]["code"]

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ja: { translation: ja },
      vi: { translation: vi },
    },
    supportedLngs: LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    fallbackLng: "en",
    interpolation: { escapeValue: false }, // React escapes
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "lang",
      caches: ["localStorage"],
    },
  })

const DATE_LOCALES: Record<Language, Locale> = { en: enUS, ja: jaDate, vi: viDate }

const toLanguage = (lng: string | undefined): Language =>
  LANGUAGES.find((l) => lng?.startsWith(l.code))?.code ?? "en"

// <html lang> drives :lang(ja) typography and screen-reader pronunciation
const syncLang = (lng: string) => {
  document.documentElement.lang = toLanguage(lng)
}
syncLang(i18n.resolvedLanguage ?? "en")
i18n.on("languageChanged", syncLang)

export const currentLanguage = (): Language => toLanguage(i18n.resolvedLanguage)

/** date-fns locale for the active language; pass it to every `format` call. */
export const dateLocale = (): Locale => DATE_LOCALES[currentLanguage()]

/** `dateLocale()` that re-renders the caller when the language changes. */
export function useDateLocale(): Locale {
  const { i18n: instance } = useTranslation()
  return DATE_LOCALES[toLanguage(instance.resolvedLanguage)]
}

/** Localized copy for a failed request, keyed by `ApiError.code`. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return i18n.t(`errors.${error.code}`)
  return i18n.t("errors.NETWORK")
}

export default i18n
