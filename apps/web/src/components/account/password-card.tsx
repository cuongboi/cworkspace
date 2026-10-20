import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useId, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { authClient } from "@/lib/auth-client"

const MIN_LENGTH = 8

type Values = { current: string; next: string; confirm: string }
type Errors = Partial<Record<keyof Values, string>>

const EMPTY: Values = { current: "", next: "", confirm: "" }

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  autoComplete: "current-password" | "new-password"
  invalid: boolean
}) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("account.password.hide") : t("account.password.show")}
          aria-pressed={visible}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function PasswordCard({ onOthersRevoked }: { onOthersRevoked?: () => void }) {
  const { t } = useTranslation()
  const id = useId()
  const [values, setValues] = useState<Values>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [signOutOthers, setSignOutOthers] = useState(true)
  const [pending, setPending] = useState(false)

  const set = (key: keyof Values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    // clear a field's error as soon as the user edits it
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const validate = (): Errors => {
    const next: Errors = {}
    if (!values.current) next.current = t("account.password.wrongCurrent")
    if (values.next.length < MIN_LENGTH) next.next = t("account.password.tooShort")
    else if (values.next === values.current)
      next.next = t("account.password.sameAsCurrent")
    if (values.confirm !== values.next) next.confirm = t("account.password.mismatch")
    return next
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.values(found).some(Boolean)) return
    setPending(true)
    const { error } = await authClient.changePassword({
      currentPassword: values.current,
      newPassword: values.next,
      revokeOtherSessions: signOutOthers,
    })
    setPending(false)
    if (error) {
      if (error.code === "INVALID_PASSWORD")
        return setErrors({ current: t("account.password.wrongCurrent") })
      if (error.code === "PASSWORD_TOO_SHORT")
        return setErrors({ next: t("account.password.tooShort") })
      return toast.error(t("account.password.failed"))
    }
    setValues(EMPTY)
    toast.success(t("account.password.updated"))
    if (signOutOthers) onOthersRevoked?.()
  }

  const fields = [
    { key: "current", label: t("account.password.current"), auto: "current-password" },
    { key: "next", label: t("account.password.new"), auto: "new-password" },
    { key: "confirm", label: t("account.password.confirm"), auto: "new-password" },
  ] as const

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("account.password.title")}</CardTitle>
        <CardDescription>{t("account.password.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="max-w-md">
          <FieldGroup>
            {fields.map((f) => (
              <Field key={f.key} data-invalid={!!errors[f.key] || undefined}>
                <FieldLabel htmlFor={`${id}-${f.key}`}>{f.label}</FieldLabel>
                <PasswordInput
                  id={`${id}-${f.key}`}
                  value={values[f.key]}
                  onChange={set(f.key)}
                  autoComplete={f.auto}
                  invalid={!!errors[f.key]}
                />
                {errors[f.key] ? <FieldError>{errors[f.key]}</FieldError> : null}
              </Field>
            ))}
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-others`}
                checked={signOutOthers}
                onCheckedChange={(v) => setSignOutOthers(v === true)}
              />
              <FieldContent>
                <FieldLabel htmlFor={`${id}-others`}>
                  {t("account.password.signOutOthers")}
                </FieldLabel>
                <FieldDescription>
                  {t("account.password.signOutOthersHint")}
                </FieldDescription>
              </FieldContent>
            </Field>
            <Button type="submit" className="self-start" disabled={pending}>
              {pending ? t("common.saving") : t("account.password.submit")}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
