import { useQueryStates, parseAsString } from "nuqs"
import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"

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
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"
import { FormError } from "./auth-layout"

/** better-auth redirects here with `?token=…` on success or `?error=INVALID_TOKEN`. */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [{ token, error: linkError }] = useQueryStates({
    token: parseAsString,
    error: parseAsString,
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!token) return
    const form = new FormData(e.currentTarget)
    const newPassword = String(form.get("password"))
    if (newPassword !== form.get("confirmPassword")) {
      return setError("Passwords do not match")
    }
    setPending(true)
    setError(null)
    const { error } = await authClient.resetPassword({ newPassword, token })
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
      <form onSubmit={onSubmit}>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <FormError message={error} />
        </CardContent>
        <CardFooter className="mt-6">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Reset password"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
