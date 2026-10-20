import { useQueryState } from "nuqs"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
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
import { redirectParser, safeRedirect } from "@/lib/search-params"
import { FormError } from "./auth-layout"

type Values = { email: string; password: string }

function useSchema() {
  const { t } = useTranslation()
  return useMemo(() => {
    const shape = {
      email: z.email(t("auth.validation.email")),
      password: z.string().min(1, t("auth.validation.password")),
    }
    const schema: AutoFormSchema<typeof shape> = {
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
        meta: { type: "password", autoComplete: "current-password" },
      },
    }
    return schema
  }, [t])
}

export function SignInPage() {
  const { t } = useTranslation()
  const schema = useSchema()
  const navigate = useNavigate()
  const [redirect] = useQueryState("redirect", redirectParser)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(values: Values) {
    setPending(true)
    setError(null)
    const { error } = await authClient.signIn.email(values)
    setPending(false)
    if (error) return setError(error.message ?? t("auth.signIn.failed"))
    navigate(safeRedirect(redirect), { replace: true })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.signIn.title")}</CardTitle>
        <CardDescription>{t("auth.signIn.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <AutoForm
          schema={schema}
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
          panels={[
            {
              after: "password",
              watch: [],
              render: () => (
                <Link
                  to="/forgot-password"
                  className="-mt-2 self-end text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  {t("auth.signIn.forgot")}
                </Link>
              ),
            },
          ]}
        >
          <FormError message={error} />
          <Button type="submit" className="mt-2 w-full" disabled={pending}>
            {pending ? t("auth.signIn.pending") : t("auth.signIn.submit")}
          </Button>
        </AutoForm>
      </CardContent>
      <CardFooter className="mt-4">
        <p className="text-sm text-muted-foreground">
          {t("auth.signIn.noAccount")}{" "}
          <Link
            to={{ pathname: "/sign-up", search: window.location.search }}
            className="text-foreground underline-offset-4 hover:underline"
          >
            {t("auth.signIn.signUp")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
