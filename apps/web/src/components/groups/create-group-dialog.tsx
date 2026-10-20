import type { TFunction } from "i18next"
import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { z } from "zod"
import { AutoForm, type AutoFormSchema } from "@/components/ui/auto-form"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useApp } from "@/hooks/use-app"
import i18n, { errorMessage } from "@/lib/i18n"
import { ApiError, db } from "@/lib/api-client"
import { useDbMutation } from "@/lib/query"
import { slugify } from "@/lib/slug"
import { cn } from "@/lib/utils"
import {
  GroupPostPolicy,
  GroupPrivacy,
  WikiEditPolicy,
} from "@app/api/zenstack/models"
import {
  FeatureSwitch,
  PostPolicySelect,
  WikiPolicyField,
} from "./group-features-fields"
import { PrivacyPicker } from "./privacy-picker"
import {
  type PickedUser,
  PeoplePicker,
} from "@/components/calendar/people-picker"

const shape = {
  name: z
    .string()
    .trim()
    .min(1, { error: () => i18n.t("groups.form.nameRequired") })
    .max(80),
  description: z.string().trim().max(1000),
  privacy: z.enum(GroupPrivacy).default(GroupPrivacy.PUBLIC),
  members: z.custom<PickedUser[]>().default([]),
  postPolicy: z.enum(GroupPostPolicy).default(GroupPostPolicy.MEMBERS),
  wikiEnabled: z.boolean().default(true),
  // rendered by the panel after `wikiEnabled`, only while the wiki is on
  wikiEditPolicy: z.enum(WikiEditPolicy).default(WikiEditPolicy.MEMBERS),
  channelsEnabled: z.boolean().default(true),
  calendarEnabled: z.boolean().default(true),
}
type Draft = z.infer<z.ZodObject<typeof shape>>

const buildSchema = (t: TFunction): AutoFormSchema<typeof shape> => ({
  name: {
    schema: shape.name,
    as: Input,
    placeholder: t("groups.form.namePlaceholder"),
    meta: { autoFocus: true },
  },
  description: {
    schema: shape.description,
    as: Textarea,
    placeholder: t("groups.form.descriptionPlaceholder"),
    meta: { rows: 3 },
  },
  privacy: {
    schema: shape.privacy,
    render: ({ field }) => (
      <PrivacyPicker
        idPrefix="create-privacy"
        value={field.value as GroupPrivacy}
        onChange={field.onChange}
        disabled={field.disabled}
      />
    ),
  },
  members: {
    schema: shape.members,
    label: t("groups.features.members"),
    render: ({ field }) => (
      <PeoplePicker
        value={(field.value as PickedUser[] | undefined) ?? []}
        onChange={field.onChange}
      />
    ),
  },
  postPolicy: {
    schema: shape.postPolicy,
    label: t("groups.features.postPolicy"),
    render: ({ id, field }) => (
      <PostPolicySelect
        id={id}
        value={field.value as GroupPostPolicy}
        onChange={field.onChange}
        disabled={field.disabled}
      />
    ),
  },
  wikiEnabled: {
    schema: shape.wikiEnabled,
    render: ({ id, field }) => (
      <FeatureSwitch
        id={id}
        feature="wikiEnabled"
        checked={field.value as boolean}
        onChange={field.onChange}
        disabled={field.disabled}
      />
    ),
  },
  wikiEditPolicy: { schema: shape.wikiEditPolicy, hidden: true },
  channelsEnabled: {
    schema: shape.channelsEnabled,
    render: ({ id, field }) => (
      <FeatureSwitch
        id={id}
        feature="channelsEnabled"
        checked={field.value as boolean}
        onChange={field.onChange}
        disabled={field.disabled}
      />
    ),
  },
  calendarEnabled: {
    schema: shape.calendarEnabled,
    render: ({ id, field }) => (
      <FeatureSwitch
        id={id}
        feature="calendarEnabled"
        checked={field.value as boolean}
        onChange={field.onChange}
        disabled={field.disabled}
      />
    ),
  },
})

export function CreateGroupDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { me } = useApp()
  const formRef = useRef<HTMLFormElement>(null)
  const create = useDbMutation(
    async (d: Draft) => {
      // "discover" is the /groups/discover page, not a group
      const raw = slugify(d.name) || "group"
      const base = raw === "discover" ? "discover-group" : raw
      const attempt = (slug: string) =>
        db.group.create({
          data: {
            name: d.name,
            slug,
            description: d.description || null,
            privacy: d.privacy,
            postPolicy: d.postPolicy,
            wikiEnabled: d.wikiEnabled,
            wikiEditPolicy: d.wikiEditPolicy,
            channelsEnabled: d.channelsEnabled,
            calendarEnabled: d.calendarEnabled,
            members: {
              create: [
                { userId: me.id, role: "ADMIN" },
                ...d.members
                  .filter((u) => u.id !== me.id)
                  .map((u) => ({ userId: u.id })),
              ],
            },
          },
          select: { slug: true },
        })
      try {
        return await attempt(base)
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "CONFLICT")) throw err
        return attempt(
          `${base.slice(0, 42)}-${Math.random().toString(36).slice(2, 7)}`
        )
      }
    },
    { invalidates: ["group", "groupMember"] }
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90svh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>{t("groups.create.title")}</DialogTitle>
          <DialogDescription>
            {t("groups.create.description")}
          </DialogDescription>
        </DialogHeader>
        <div
          className={cn(
            "flex scrollbar-thin size-full min-h-0 min-w-0 flex-1 scrollbar-gutter-stable flex-col overflow-y-auto overscroll-contain px-6 py-2 [overflow-anchor:none]"
          )}
          style={{
            scrollbarWidth: "unset",
          }}
        >
          <AutoForm
            ref={formRef}
            schema={buildSchema(t)}
            panels={[
              {
                before: "postPolicy",
                watch: [],
                render: () => (
                  <h3 className="text-sm font-semibold">
                    {t("groups.features.title")}
                  </h3>
                ),
              },
              {
                after: "wikiEnabled",
                watch: ["wikiEnabled", "wikiEditPolicy"],
                render: ({ form }) =>
                  form.getValues("wikiEnabled") ? (
                    <WikiPolicyField
                      id="create-wiki-policy"
                      value={form.getValues("wikiEditPolicy")}
                      onChange={(value) =>
                        form.setValue("wikiEditPolicy", value)
                      }
                    />
                  ) : null,
              },
            ]}
            className="flex flex-col gap-6"
            onSubmit={(draft, form) =>
              create.mutate(draft, {
                onSuccess: (group) => {
                  toast.success(t("groups.create.created"))
                  form.reset()
                  // the dialog isn't always unmounted by navigating (e.g. opened from the sidebar)
                  onOpenChange(false)
                  void navigate(`/groups/${group.slug}`)
                },
                onError: (err) => toast.error(errorMessage(err)),
              })
            }
          />
        </div>
        <DialogFooter className="p-6 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          {/* the footer sits outside the scrolling form, so submit it by ref */}
          <Button
            type="button"
            disabled={create.isPending}
            onClick={() => formRef.current?.requestSubmit()}
          >
            {create.isPending ? <Spinner /> : null}
            {t("groups.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
