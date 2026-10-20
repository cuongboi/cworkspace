import { useQueryState } from "nuqs"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useNavigate } from "react-router-dom"
import type { UseFormReturn } from "react-hook-form"
import { z } from "zod"

import { AutoForm, type AutoFormSchema } from "@/components/ui/auto-form"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import { redirectParser, safeRedirect } from "@/lib/search-params"
import { FormError } from "./auth-layout"

type Values = {
  name: string
  email: string
  password: string
  confirmPassword: string
}

const newPassword = { type: "password", autoComplete: "new-password" }

function useSchema() {
  const { t } = useTranslation()
  return useMemo(() => {
    const min = t("auth.validation.passwordLength")
    const shape = {
      name: z.string().trim().min(1, t("auth.validation.name")),
      email: z.email(t("auth.validation.email")),
      password: z.string().min(8, min),
      confirmPassword: z.string().min(8, min),
    }
    const schema: AutoFormSchema<typeof shape> = {
      name: {
        schema: shape.name,
        label: t("auth.fields.name"),
        as: Input,
        meta: { autoComplete: "name" },
      },
      email: {
        schema: shape.email,
        label: t("auth.fields.email"),
        as: Input,
        meta: { type: "email", autoComplete: "email" },
      },
      password: {
        schema: shape.password,
        label: t("auth.fields.password"),
        as: Input,
        meta: newPassword,
      },
      confirmPassword: {
        schema: shape.confirmPassword,
        label: t("auth.fields.confirmPassword"),
        as: Input,
        meta: newPassword,
      },
    }
    return schema
  }, [t])
}

export function SignUpPage() {
  const { t } = useTranslation()
  const schema = useSchema()
  const navigate = useNavigate()
  const [redirect] = useQueryState("redirect", redirectParser)
  // prefilled from an invitation link (/invite/:id)
  const [invitedEmail] = useQueryState("email")
  const defaultValues = useMemo(
    () => ({ email: invitedEmail ?? "" }),
    [invitedEmail]
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(values: Values, form: UseFormReturn<Values>) {
    if (values.password !== values.confirmPassword) {
      return form.setError("confirmPassword", {
        message: t("auth.validation.passwordMismatch"),
      })
    }
    setPending(true)
    setError(null)
    const { error } = await authClient.signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
    })
    setPending(false)
    if (error) return setError(error.message ?? t("auth.signUp.failed"))
    navigate(safeRedirect(redirect), { replace: true })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.signUp.title")}</CardTitle>
        <CardDescription>{t("auth.signUp.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <AutoForm
          schema={schema}
          defaultValues={defaultValues}
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
        >
          <FormError message={error} />
          <Button type="submit" className="mt-2 w-full" disabled={pending}>
            {pending ? t("auth.signUp.pending") : t("auth.signUp.submit")}
          </Button>
        </AutoForm>
      </CardContent>
      <CardFooter className="mt-4">
        <p className="text-sm text-muted-foreground">
          {t("auth.signUp.haveAccount")}{" "}
          <Link
            to={{ pathname: "/sign-in", search: window.location.search }}
            className="text-foreground underline-offset-4 hover:underline"
          >
            {t("auth.signUp.signIn")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
