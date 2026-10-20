import { LanguagesIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useTheme } from "@/components/theme-provider"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { LANGUAGES, currentLanguage } from "@/lib/i18n"

type Theme = "light" | "dark" | "system"

export function PreferencesCard() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const themes = [
    { value: "light", label: t("account.light"), icon: SunIcon },
    { value: "dark", label: t("account.dark"), icon: MoonIcon },
    { value: "system", label: t("account.system"), icon: MonitorIcon },
  ] as const

  return (
    <Card>
      <CardContent>
        <FieldGroup>
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="account-language">
                <LanguagesIcon className="size-4 text-muted-foreground" />
                {t("account.language")}
              </FieldLabel>
              <FieldDescription>{t("account.preferences.languageDescription")}</FieldDescription>
            </FieldContent>
            <NativeSelect
              id="account-language"
              value={currentLanguage()}
              onChange={(e) => void i18n.changeLanguage(e.target.value)}
            >
              {LANGUAGES.map((l) => (
                <NativeSelectOption key={l.code} value={l.code}>
                  {l.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <FieldSeparator />
          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel>{t("account.theme")}</FieldLabel>
              <FieldDescription>{t("account.preferences.themeDescription")}</FieldDescription>
            </FieldContent>
            <ToggleGroup
              type="single"
              variant="outline"
              value={theme}
              onValueChange={(v) => v && setTheme(v as Theme)}
              aria-label={t("account.theme")}
            >
              {themes.map(({ value, label, icon: Icon }) => (
                <ToggleGroupItem key={value} value={value} className="gap-1.5 px-3">
                  <Icon />
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
