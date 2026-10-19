import { useQueryStates, parseAsString } from "nuqs"
import { useState } from "react"
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

const shape = {
  password: z.string().min(8, "Use at least 8 characters"),
  confirmPassword: z.string().min(8, "Use at least 8 characters"),
}
type Values = z.infer<z.ZodObject<typeof shape>>

const newPassword = { type: "password", autoComplete: "new-password" }

const schema: AutoFormSchema<typeof shape> = {
  password: {
    schema: shape.password,
    label: "New password",
    as: Input,
    meta: newPassword,
  },
  confirmPassword: {
    schema: shape.confirmPassword,
    label: "Confirm password",
    as: Input,
    meta: newPassword,
  },
}

/** better-auth redirects here with `?token=…` on success or `?error=INVALID_TOKEN`. */
export function ResetPasswordPage() {
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
        message: "Passwords do not match",
      })
    }
    setPending(true)
    setError(null)
    const { error } = await authClient.resetPassword({
      newPassword: values.password,
      token,
    })
    setPending(false)
    if (error) return setError(error.message ?? "Unable to reset password")
    navigate("/sign-in", { replace: true })
  }

  if (linkError || !token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invalid link</CardTitle>
          <CardDescription>
            This reset link is invalid or has expired. Request a new one.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link to="/forgot-password">Request new link</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset password</CardTitle>
        <CardDescription>
          Choose a new password for your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AutoForm
          schema={schema}
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
        >
          <FormError message={error} />
          <Button type="submit" className="mt-2 w-full" disabled={pending}>
            {pending ? "Saving…" : "Reset password"}
          </Button>
        </AutoForm>
      </CardContent>
    </Card>
  )
}
