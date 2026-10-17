import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { GroupPrivacy } from "@app/api/zenstack/models"
import { PRIVACY_DESCRIPTION, PRIVACY_LABEL } from "./group-query"
import { PrivacyIcon } from "./group-visuals"

const OPTIONS = [GroupPrivacy.PUBLIC, GroupPrivacy.CLOSED, GroupPrivacy.SECRET]

export function PrivacyPicker({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: GroupPrivacy
  onChange: (privacy: GroupPrivacy) => void
  idPrefix: string
  disabled?: boolean
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as GroupPrivacy)}
      disabled={disabled}
      aria-label="Privacy"
      className="gap-2"
    >
      {OPTIONS.map((p) => (
        <FieldLabel key={p} htmlFor={`${idPrefix}-${p}`}>
          <Field orientation="horizontal">
            <PrivacyIcon
              privacy={p}
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <FieldContent>
              <FieldTitle>{PRIVACY_LABEL[p]}</FieldTitle>
              <FieldDescription>{PRIVACY_DESCRIPTION[p]}</FieldDescription>
            </FieldContent>
            <RadioGroupItem value={p} id={`${idPrefix}-${p}`} />
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}
