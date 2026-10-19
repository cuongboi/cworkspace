import { useState } from "react"
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

const shape = { email: z.email("Enter a valid email") }

const schema: AutoFormSchema<typeof shape> = {
  email: {
    schema: shape.email,
    as: Input,
    meta: { type: "email", autoComplete: "email" },
  },
}

export function ForgotPasswordPage() {
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
    if (error) return setError(error.message ?? "Unable to send reset link")
    setSent(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot password</CardTitle>
        <CardDescription>
          {sent
            ? "If an account exists for that email, a reset link is on its way."
            : "Enter your email and we'll send you a reset link."}
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
              {pending ? "Sending…" : "Send reset link"}
            </Button>
          </AutoForm>
        </CardContent>
      )}
      <CardFooter className={sent ? undefined : "mt-4"}>
        <Link
          to="/sign-in"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  )
}
