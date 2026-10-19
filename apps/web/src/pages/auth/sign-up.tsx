import { useQueryState } from "nuqs"
import { useMemo, useState } from "react"
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

const shape = {
  name: z.string().trim().min(1, "Enter your name"),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
  confirmPassword: z.string().min(8, "Use at least 8 characters"),
}
type Values = z.infer<z.ZodObject<typeof shape>>

const newPassword = { type: "password", autoComplete: "new-password" }

const schema: AutoFormSchema<typeof shape> = {
  name: { schema: shape.name, as: Input, meta: { autoComplete: "name" } },
  email: {
    schema: shape.email,
    as: Input,
    meta: { type: "email", autoComplete: "email" },
  },
  password: { schema: shape.password, as: Input, meta: newPassword },
  confirmPassword: {
    schema: shape.confirmPassword,
    label: "Confirm password",
    as: Input,
    meta: newPassword,
  },
}

export function SignUpPage() {
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
        message: "Passwords do not match",
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
    if (error) return setError(error.message ?? "Unable to sign up")
    navigate(safeRedirect(redirect), { replace: true })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>Fill in your details to get started.</CardDescription>
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
            {pending ? "Creating account…" : "Sign up"}
          </Button>
        </AutoForm>
      </CardContent>
      <CardFooter className="mt-4">
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to={{ pathname: "/sign-in", search: window.location.search }}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
