import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
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

function useSchema() {
  const { t } = useTranslation()
  return useMemo(() => {
    const shape = { email: z.email(t("auth.validation.email")) }
    const schema: AutoFormSchema<typeof shape> = {
      email: {
        schema: shape.email,
        label: t("auth.fields.email"),
        as: Input,
        meta: { type: "email", autoComplete: "email" },
      },
    }
    return schema
  }, [t])
}

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const schema = useSchema()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit({ email }: { email: string }) {
    setPending(true)
    setError(null)
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setPending(false)
    if (error) return setError(error.message ?? t("auth.forgot.failed"))
    setSent(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.forgot.title")}</CardTitle>
        <CardDescription>
          {sent ? t("auth.forgot.sent") : t("auth.forgot.description")}
        </CardDescription>
      </CardHeader>
      {!sent && (
        <CardContent>
          <AutoForm
            schema={schema}
            onSubmit={onSubmit}
            className="flex flex-col gap-4"
          >
            <FormError message={error} />
            <Button type="submit" className="mt-2 w-full" disabled={pending}>
              {pending ? t("auth.forgot.pending") : t("auth.forgot.submit")}
            </Button>
          </AutoForm>
        </CardContent>
      )}
      <CardFooter className={sent ? undefined : "mt-4"}>
        <Link
          to="/sign-in"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("auth.forgot.backToSignIn")}
        </Link>
      </CardFooter>
    </Card>
  )
}
