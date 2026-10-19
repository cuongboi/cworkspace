import { useQueryState } from "nuqs"
import { useState } from "react"
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

const shape = {
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
}

const schema: AutoFormSchema<typeof shape> = {
  email: {
    schema: shape.email,
    as: Input,
    meta: { type: "email", autoComplete: "email" },
  },
  password: {
    schema: shape.password,
    as: Input,
    meta: { type: "password", autoComplete: "current-password" },
  },
}

export function SignInPage() {
  const navigate = useNavigate()
  const [redirect] = useQueryState("redirect", redirectParser)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(values: z.infer<z.ZodObject<typeof shape>>) {
    setPending(true)
    setError(null)
    const { error } = await authClient.signIn.email(values)
    setPending(false)
    if (error) return setError(error.message ?? "Unable to sign in")
    navigate(safeRedirect(redirect), { replace: true })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Enter your email and password.</CardDescription>
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
                  Forgot password?
                </Link>
              ),
            },
          ]}
        >
          <FormError message={error} />
          <Button type="submit" className="mt-2 w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </AutoForm>
      </CardContent>
      <CardFooter className="mt-4">
        <p className="text-sm text-muted-foreground">
          No account?{" "}
          <Link
            to={{ pathname: "/sign-up", search: window.location.search }}
            className="text-foreground underline-offset-4 hover:underline"
          >
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
