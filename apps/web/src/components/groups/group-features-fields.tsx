import { useTranslation } from "react-i18next"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import type { GroupPostPolicy, WikiEditPolicy } from "@app/api/zenstack/models"

export type GroupFeatures = {
  wikiEnabled: boolean
  channelsEnabled: boolean
  calendarEnabled: boolean
  postPolicy: GroupPostPolicy
  wikiEditPolicy: WikiEditPolicy
}

type Feature = "wikiEnabled" | "channelsEnabled" | "calendarEnabled"

/** One on/off feature row: title and hint on the left, switch on the right. */
export function FeatureSwitch({
  id,
  feature,
  checked,
  onChange,
  disabled,
}: {
  id: string
  feature: Feature
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{t(`groups.features.${feature}`)}</FieldLabel>
        <FieldDescription>
          {t(`groups.features.${feature}Hint`)}
        </FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </Field>
  )
}

export function PostPolicySelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: GroupPostPolicy
  onChange: (value: GroupPostPolicy) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <NativeSelect
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as GroupPostPolicy)}
      disabled={disabled}
      className="w-full"
    >
      <NativeSelectOption value="MEMBERS">
        {t("groups.features.postMembers")}
      </NativeSelectOption>
      <NativeSelectOption value="ADMINS">
        {t("groups.features.postAdmins")}
      </NativeSelectOption>
    </NativeSelect>
  )
}

/** "Who can edit the wiki", only meaningful while the wiki is on. */
export function WikiPolicyField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: WikiEditPolicy
  onChange: (value: WikiEditPolicy) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("groups.edit.wikiPolicy")}</FieldLabel>
      <NativeSelect
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as WikiEditPolicy)}
        disabled={disabled}
        className="w-full"
      >
        <NativeSelectOption value="MEMBERS">
          {t("groups.edit.wikiMembers")}
        </NativeSelectOption>
        <NativeSelectOption value="ADMINS">
          {t("groups.edit.wikiAdmins")}
        </NativeSelectOption>
      </NativeSelect>
      <FieldDescription>{t("groups.edit.wikiPolicyHint")}</FieldDescription>
    </Field>
  )
}

/** Optional features of a group, as one controlled value (the edit dialog). */
export function GroupFeaturesFields({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string
  value: GroupFeatures
  onChange: (value: GroupFeatures) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const set = (patch: Partial<GroupFeatures>) =>
    onChange({ ...value, ...patch })
  const toggle = (feature: Feature) => (
    <FeatureSwitch
      id={`${idPrefix}-${feature}`}
      feature={feature}
      checked={value[feature]}
      onChange={(checked) => set({ [feature]: checked })}
      disabled={disabled}
    />
  )

  return (
    <FieldSet className="gap-4">
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-post-policy`}>
          {t("groups.features.postPolicy")}
        </FieldLabel>
        <PostPolicySelect
          id={`${idPrefix}-post-policy`}
          value={value.postPolicy}
          onChange={(postPolicy) => set({ postPolicy })}
          disabled={disabled}
        />
      </Field>
      {toggle("wikiEnabled")}
      {value.wikiEnabled ? (
        <WikiPolicyField
          id={`${idPrefix}-wiki-policy`}
          value={value.wikiEditPolicy}
          onChange={(wikiEditPolicy) => set({ wikiEditPolicy })}
          disabled={disabled}
        />
      ) : null}
      {toggle("channelsEnabled")}
      {toggle("calendarEnabled")}
    </FieldSet>
  )
}
