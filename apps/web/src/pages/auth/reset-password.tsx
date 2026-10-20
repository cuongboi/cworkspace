import { useQueryStates, parseAsString } from "nuqs"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import type { UseFormReturn } from "react-hook-form"
import { Link, useNavigate } from "react-router-dom"
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
import { FormError } from "./auth-layout"

type Values = { password: string; confirmPassword: string }

const newPassword = { type: "password", autoComplete: "new-password" }

function useSchema() {
  const { t } = useTranslation()
  return useMemo(() => {
    const min = t("auth.validation.passwordLength")
    const shape = {
      password: z.string().min(8, min),
      confirmPassword: z.string().min(8, min),
    }
    const schema: AutoFormSchema<typeof shape> = {
      password: {
        schema: shape.password,
        label: t("auth.fields.newPassword"),
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

/** better-auth redirects here with `?token=…` on success or `?error=INVALID_TOKEN`. */
export function ResetPasswordPage() {
  const { t } = useTranslation()
  const schema = useSchema()
  const navigate = useNavigate()
  const [{ token, error: linkError }] = useQueryStates({
    token: parseAsString,
    error: parseAsString,
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(values: Values, form: UseFormReturn<Values>) {
    if (!token) return
    if (values.password !== values.confirmPassword) {
      return form.setError("confirmPassword", {
        message: t("auth.validation.passwordMismatch"),
      })
    }
    setPending(true)
    setError(null)
    const { error } = await authClient.resetPassword({
      newPassword: values.password,
      token,
    })
    setPending(false)
    if (error) return setError(error.message ?? t("auth.reset.failed"))
    navigate("/sign-in", { replace: true })
  }

  if (linkError || !token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("auth.reset.invalidTitle")}</CardTitle>
          <CardDescription>
            {t("auth.reset.invalidDescription")}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link to="/forgot-password">{t("auth.reset.requestNew")}</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.reset.title")}</CardTitle>
        <CardDescription>{t("auth.reset.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <AutoForm
          schema={schema}
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
        >
          <FormError message={error} />
          <Button type="submit" className="mt-2 w-full" disabled={pending}>
            {pending ? t("common.saving") : t("auth.reset.submit")}
          </Button>
        </AutoForm>
      </CardContent>
    </Card>
  )
}
