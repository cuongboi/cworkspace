import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  MAX_GLOSSARY_TERM_CHARS,
  MAX_GLOSSARY_TERMS,
} from "@/lib/realtime-events"
import { useTranslation } from "react-i18next"

function parseTerms(text: string) {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((t) => t.trim().slice(0, MAX_GLOSSARY_TERM_CHARS))
        .filter(Boolean)
    ),
  ].slice(0, MAX_GLOSSARY_TERMS)
}

/** The call's shared glossary: names and terms everyone's live captions should recognise. */
export function GlossaryDialog({
  open,
  terms,
  onOpenChange,
  onSave,
}: {
  open: boolean
  terms: string[]
  onOpenChange: (open: boolean) => void
  onSave: (terms: string[]) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark bg-background text-foreground">
        {/* remounted on open, so the draft starts from the current glossary */}
        {open ? (
          <GlossaryForm
            terms={terms}
            onCancel={() => onOpenChange(false)}
            onSave={(next) => {
              onSave(next)
              onOpenChange(false)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function GlossaryForm({
  terms,
  onCancel,
  onSave,
}: {
  terms: string[]
  onCancel: () => void
  onSave: (terms: string[]) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(terms.join("\n"))
  const count = parseTerms(draft).length
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(parseTerms(draft))
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("call.glossary.title")}</DialogTitle>
        <DialogDescription>{t("call.glossary.description")}</DialogDescription>
      </DialogHeader>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={8}
        placeholder={"Nguyễn Văn An\n田中さん\nKubernetes"}
        aria-label={t("call.glossary.terms")}
      />
      <p className="text-xs text-muted-foreground">
        {t("call.glossary.count", { count, max: MAX_GLOSSARY_TERMS })}
      </p>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit">{t("common.save")}</Button>
      </DialogFooter>
    </form>
  )
}
