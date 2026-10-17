import { useNavigate } from "react-router-dom"
import { useState } from "react"
import { AuthCard } from "@/components/layout/auth-card"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { slugify } from "@/lib/slug"

// URL segments the app uses at the top level
/** Top-level SPA/API paths an org slug must not shadow (see `src/router.tsx`, apps/api). */
const RESERVED = new Set([
  "api",
  "ws",
  "openapi",
  "health",
  "assets",
  "sign-in",
  "sign-up",
  "forgot-password",
  "reset-password",
  "onboarding",
  "invite",
  "settings",
])

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const effectiveSlug = slugTouched ? slug : slugify(name)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (RESERVED.has(effectiveSlug))
      return setError("This URL is reserved, pick another one")
    setPending(true)
    setError(null)
    const { data, error } = await authClient.organization.create({
      name: name.trim(),
      slug: effectiveSlug,
    })
    if (error || !data) {
      setPending(false)
      return setError(error?.message ?? "Could not create the organization")
    }
    await authClient.organization.setActive({ organizationId: data.id })
    await navigate(`/${data.slug}`, { replace: true })
  }

  return (
    <AuthCard
      title="Create your organization"
      description="Your company's private workplace"
    >
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Organization name</FieldLabel>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              required
              maxLength={80}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="slug">URL</FieldLabel>
            <div className="flex items-center rounded-md border focus-within:ring-2 focus-within:ring-ring/50">
              <span className="pl-3 text-sm text-muted-foreground">
                cworkplace/
              </span>
              <Input
                id="slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(slugify(e.target.value))
                }}
                className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
                required
                pattern="[a-z0-9\-]{2,48}"
              />
            </div>
            <FieldDescription>
              Lowercase letters, numbers and dashes.
            </FieldDescription>
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <Button
            type="submit"
            disabled={pending || !name.trim() || effectiveSlug.length < 2}
            className="w-full"
          >
            {pending ? <Spinner /> : null}
            Create organization
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  )
}
