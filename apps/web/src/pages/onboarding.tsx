import { useQuery } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Navigate } from "react-router-dom"
import { PageTitle } from "@/components/common/page-title"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { ApiError, api } from "@/lib/api-client"
import { APP_CONFIG } from "@/lib/company"
import { cn } from "@/lib/utils"

/**
 * First run (no user yet): creates the admin and the first settings. The server only accepts
 * it with the setup token printed in its console, which arrives in the link's fragment
 * (`#token=…`, never sent to any server) and is kept in memory only.
 */

type CaptionProvider = "soniox" | "gemini" | "off"

type Form = {
  name: string
  email: string
  password: string
  confirm: string
  company: string
  description: string
  provider: CaptionProvider
  captionKey: string
  resendKey: string
  from: string
}

const MIN_PASSWORD = 8
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STEPS = ["account", "workspace", "services"] as const

/** Reads `#token=` once and removes it from the address bar and history. */
function takeTokenFromUrl(): string {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const token = params.get("token") ?? ""
  if (token)
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search
    )
  return token
}

// read once when the page's module loads (not in a state initializer, which StrictMode runs twice)
const linkToken = takeTokenFromUrl()

function strength(password: string): "weak" | "fair" | "strong" {
  if (password.length < MIN_PASSWORD) return "weak"
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((r) =>
    r.test(password)
  ).length
  return password.length >= 14 || (password.length >= 10 && classes >= 3)
    ? "strong"
    : "fair"
}

export default function OnboardingPage() {
  const { t } = useTranslation()
  const [token, setToken] = useState(linkToken)
  const [pasted, setPasted] = useState("")
  const [step, setStep] = useState(0)
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<Form>({
    name: "",
    email: "",
    password: "",
    confirm: "",
    company: APP_CONFIG.name,
    description: "",
    provider: "soniox",
    captionKey: "",
    resendKey: "",
    from: "",
  })
  const status = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => api.get<{ required: boolean }>("/api/onboarding"),
    staleTime: Infinity,
  })

  if (status.isPending)
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner />
      </div>
    )
  if (status.data && !status.data.required)
    return <Navigate to="/sign-in" replace />

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const accountErrors = {
    email: !EMAIL.test(form.email.trim()),
    weak: form.password.length < MIN_PASSWORD,
    sameAsEmail:
      form.password.length > 0 &&
      form.password.toLowerCase() === form.email.trim().toLowerCase(),
    mismatch: form.confirm !== form.password,
    name: !form.name.trim(),
  }
  const stepValid = [!Object.values(accountErrors).some(Boolean), true, true][
    step
  ]

  const next = () => {
    setTouched(true)
    if (!stepValid) return
    setTouched(false)
    setStep((s) => s + 1)
  }

  const submit = async (withServices: boolean) => {
    setError(null)
    setSubmitting(true)
    try {
      await api.post(
        "/api/onboarding",
        {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          settings: {
            branding: {
              name: form.company.trim() || undefined,
              description: form.description.trim() || undefined,
            },
            ...(withServices
              ? {
                  captions: {
                    provider: form.provider,
                    apiKey: form.captionKey || undefined,
                  },
                  email: {
                    resendApiKey: form.resendKey || undefined,
                    from: form.from.trim() || undefined,
                  },
                }
              : {}),
          },
        },
        { "x-setup-token": token }
      )
      // a full load: the shell is rendered again without the onboarding flag, with the new
      // branding, and the session cookie set by the response
      window.location.replace("/settings?tab=general")
    } catch (err) {
      setSubmitting(false)
      if (
        err instanceof ApiError &&
        err.code === "FORBIDDEN" &&
        (err.details as { reason?: string } | undefined)?.reason === "origin"
      ) {
        setError(t("onboarding.crossOrigin"))
      } else if (err instanceof ApiError && err.code === "FORBIDDEN") {
        setToken("")
        setError(t("onboarding.token.invalid"))
      } else if (err instanceof ApiError && err.code === "CONFLICT") {
        window.location.replace("/sign-in")
      } else
        setError(err instanceof Error ? err.message : t("onboarding.failed"))
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <PageTitle title={t("onboarding.pageTitle")} />
      <div className="w-full max-w-md">
        {!token ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("onboarding.token.title")}</CardTitle>
              <CardDescription>{t("onboarding.token.body")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  const v = pasted.trim().replace(/^.*#token=/, "")
                  if (v) {
                    setToken(decodeURIComponent(v))
                    setError(null)
                  }
                  setPasted("")
                }}
              >
                <Field data-invalid={Boolean(error) || undefined}>
                  <FieldLabel htmlFor="setup-token">
                    {t("onboarding.token.label")}
                  </FieldLabel>
                  <Input
                    id="setup-token"
                    type="password"
                    autoComplete="off"
                    className="font-mono"
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                  />
                  {error ? <FieldError>{error}</FieldError> : null}
                </Field>
                <Button type="submit" disabled={!pasted.trim()}>
                  {t("onboarding.token.submit")}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <Stepper step={step} />
              <CardTitle>{t("onboarding.title")}</CardTitle>
              <CardDescription>
                {t(`onboarding.${STEPS[step]}.body`)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                id="onboarding"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (step < STEPS.length - 1) next()
                  else void submit(true)
                }}
              >
                {step === 0 ? (
                  <AccountStep
                    form={form}
                    set={set}
                    errors={touched ? accountErrors : null}
                  />
                ) : step === 1 ? (
                  <WorkspaceStep form={form} set={set} />
                ) : (
                  <ServicesStep form={form} set={set} />
                )}
                {error ? (
                  <p role="alert" className="mt-4 text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </form>
            </CardContent>
            <CardFooter className="flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={step === 0 || submitting}
                onClick={() => setStep((s) => s - 1)}
              >
                {t("onboarding.back")}
              </Button>
              <div className="flex gap-2">
                {step === STEPS.length - 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => void submit(false)}
                  >
                    {t("onboarding.skip")}
                  </Button>
                ) : null}
                <Button type="submit" form="onboarding" disabled={submitting}>
                  {submitting ? <Spinner /> : null}
                  {step === STEPS.length - 1
                    ? submitting
                      ? t("onboarding.finishing")
                      : t("onboarding.finish")
                    : t("onboarding.next")}
                </Button>
              </div>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  )
}

/** Numbered progress for the setup steps; finished ones show a check. */
function Stepper({ step }: { step: number }) {
  const { t } = useTranslation()
  return (
    <ol
      className="mb-4 flex items-center gap-2"
      aria-label={t("onboarding.stepOf", {
        step: step + 1,
        total: STEPS.length,
      })}
    >
      {STEPS.map((key, i) => {
        const done = i < step
        const current = i === step
        return (
          <li
            key={key}
            className="flex min-w-0 flex-1 items-center gap-2"
            aria-current={current ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                done && "border-primary bg-primary text-primary-foreground",
                current && "border-primary text-foreground",
                !done && !current && "text-muted-foreground"
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "truncate text-xs",
                current
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {t(`onboarding.steps.${key}`)}
            </span>
            {i < STEPS.length - 1 ? (
              <span
                className={cn("h-px flex-1 bg-border", done && "bg-primary")}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

type StepProps = {
  form: Form
  set: <K extends keyof Form>(key: K, value: Form[K]) => void
}

function AccountStep({
  form,
  set,
  errors,
}: StepProps & {
  errors: Record<
    "email" | "weak" | "sameAsEmail" | "mismatch" | "name",
    boolean
  > | null
}) {
  const { t } = useTranslation()
  const level = strength(form.password)
  return (
    <FieldGroup>
      <Field data-invalid={errors?.name || undefined}>
        <FieldLabel htmlFor="ob-name">
          {t("onboarding.account.name")}
        </FieldLabel>
        <Input
          id="ob-name"
          autoComplete="name"
          maxLength={100}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>
      <Field data-invalid={errors?.email || undefined}>
        <FieldLabel htmlFor="ob-email">
          {t("onboarding.account.email")}
        </FieldLabel>
        <Input
          id="ob-email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
        />
      </Field>
      <Field data-invalid={errors?.weak || errors?.sameAsEmail || undefined}>
        <FieldLabel htmlFor="ob-password">
          {t("onboarding.account.password")}
          {form.password ? (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {t(`onboarding.account.strength.${level}`)}
            </span>
          ) : null}
        </FieldLabel>
        <Input
          id="ob-password"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          value={form.password}
          onChange={(e) => set("password", e.target.value)}
        />
        {errors?.weak ? (
          <FieldError>{t("onboarding.account.weak")}</FieldError>
        ) : errors?.sameAsEmail ? (
          <FieldError>{t("onboarding.account.sameAsEmail")}</FieldError>
        ) : (
          <FieldDescription>
            {t("onboarding.account.passwordHint")}
          </FieldDescription>
        )}
      </Field>
      <Field data-invalid={errors?.mismatch || undefined}>
        <FieldLabel htmlFor="ob-confirm">
          {t("onboarding.account.confirm")}
        </FieldLabel>
        <Input
          id="ob-confirm"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          value={form.confirm}
          onChange={(e) => set("confirm", e.target.value)}
        />
        {errors?.mismatch ? (
          <FieldError>{t("onboarding.account.mismatch")}</FieldError>
        ) : null}
      </Field>
    </FieldGroup>
  )
}

function WorkspaceStep({ form, set }: StepProps) {
  const { t } = useTranslation()
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="ob-company">
          {t("onboarding.workspace.name")}
        </FieldLabel>
        <Input
          id="ob-company"
          maxLength={60}
          value={form.company}
          onChange={(e) => set("company", e.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="ob-description">
          {t("onboarding.workspace.description")}
        </FieldLabel>
        <Input
          id="ob-description"
          maxLength={300}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
    </FieldGroup>
  )
}

function ServicesStep({ form, set }: StepProps) {
  const { t } = useTranslation()
  return (
    <FieldGroup>
      <h3 className="font-medium">{t("onboarding.services.captions")}</h3>
      <Field>
        <FieldLabel htmlFor="ob-provider">
          {t("onboarding.services.provider")}
        </FieldLabel>
        <NativeSelect
          id="ob-provider"
          value={form.provider}
          onChange={(e) => set("provider", e.target.value as CaptionProvider)}
        >
          {(["soniox", "gemini", "off"] as const).map((p) => (
            <NativeSelectOption key={p} value={p}>
              {t(`settings.app.integrations.providers.${p}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {form.provider !== "off" ? (
        <Field>
          <FieldLabel htmlFor="ob-caption-key">
            {t("onboarding.services.apiKey")}
          </FieldLabel>
          <Input
            id="ob-caption-key"
            type="password"
            autoComplete="off"
            className="font-mono"
            value={form.captionKey}
            onChange={(e) => set("captionKey", e.target.value.trim())}
          />
        </Field>
      ) : null}
      <div className="flex flex-col gap-1 border-t pt-5">
        <h3 className="font-medium">{t("onboarding.services.email")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("onboarding.services.emailBody")}
        </p>
      </div>
      <Field>
        <FieldLabel htmlFor="ob-resend">
          {t("onboarding.services.resendKey")}
        </FieldLabel>
        <Input
          id="ob-resend"
          type="password"
          autoComplete="off"
          className="font-mono"
          value={form.resendKey}
          onChange={(e) => set("resendKey", e.target.value.trim())}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="ob-from">
          {t("onboarding.services.from")}
        </FieldLabel>
        <Input
          id="ob-from"
          maxLength={200}
          placeholder="Acme <hello@acme.com>"
          value={form.from}
          onChange={(e) => set("from", e.target.value)}
        />
      </Field>
    </FieldGroup>
  )
}
