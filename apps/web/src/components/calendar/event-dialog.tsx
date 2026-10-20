import { useQueryClient } from "@tanstack/react-query"
import { addHours, endOfDay, format, parse, startOfDay } from "date-fns"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useApp } from "@/hooks/use-app"
import { db } from "@/lib/api-client"
import { errorMessage } from "@/lib/i18n"
import { invalidateModels, useDbQuery } from "@/lib/query"
import type { EventType } from "@app/api/zenstack/models"
import {
  buildRrule,
  type CalendarEvent,
  parseRepeat,
  type RepeatOption,
  repeatLabel,
} from "./calendar-utils"
import {
  EVENT_TYPE_STYLES,
  EVENT_TYPES,
  eventTypeLabelKey,
} from "./event-colors"
import { PeoplePicker, type PickedUser } from "./people-picker"
import { ScrollArea } from "@/components/ui/scroll-area"

export type EventDialogDefaults = {
  start: Date
  allDay?: boolean
  /** create the event in this group (group calendar): the group can't be changed */
  group?: { id: string; name: string }
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** edit this event (creator only); otherwise create a new one */
  event?: CalendarEvent | null
  defaults?: EventDialogDefaults
  onSaved?: (eventId: string) => void
}

const DATE = "yyyy-MM-dd"
const TIME = "HH:mm"
const REPEAT_OPTIONS: RepeatOption[] = [
  "none",
  "daily",
  "weekly",
  "weekdays",
  "monthly",
]

function initialState(
  event: CalendarEvent | null | undefined,
  defaults: EventDialogDefaults | undefined,
  meId: string
) {
  const start = event?.startAt ?? defaults?.start ?? new Date()
  const end = event?.endAt ?? addHours(start, 0.5)
  return {
    title: event?.title ?? "",
    type: (event?.type ?? "MEETING") as EventType,
    allDay: event?.allDay ?? defaults?.allDay ?? false,
    startDate: format(start, DATE),
    startTime: format(start, TIME),
    endDate: format(end, DATE),
    endTime: format(end, TIME),
    location: event?.location ?? "",
    description: event?.description ?? "",
    groupId: event?.groupId ?? defaults?.group?.id ?? "",
    repeat: parseRepeat(event?.rrule),
    hasVideoCall: event?.hasVideoCall ?? false,
    attendees: (event?.attendees ?? [])
      .filter((a) => a.userId !== meId)
      .map((a) => a.user) as PickedUser[],
  }
}

export function EventDialog({
  open,
  onOpenChange,
  event,
  defaults,
  onSaved,
}: Props) {
  const { t } = useTranslation()
  const { me } = useApp()
  const queryClient = useQueryClient()
  const isEdit = Boolean(event)
  const [form, setForm] = useState(() => initialState(event, defaults, me.id))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const { data: groups = [] } = useDbQuery(
    ["group", "findMany", "event-dialog", me.id],
    () =>
      db.group.findMany({
        where: {
          members: { some: { userId: me.id, status: "ACTIVE" } },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    { enabled: open && !isEdit && !defaults?.group, staleTime: 60_000 }
  )

  // new group events invite the whole group by default
  const { data: groupMembers } = useDbQuery(
    ["groupMember", "findMany", "event-dialog", form.groupId],
    () =>
      db.groupMember.findMany({
        where: {
          groupId: form.groupId,
          status: "ACTIVE",
          userId: { not: me.id },
        },
        select: { user: { select: { id: true, name: true, image: true } } },
      }),
    { enabled: open && !isEdit && Boolean(form.groupId), staleTime: 60_000 }
  )
  const [seededGroupId, setSeededGroupId] = useState("")
  if (!isEdit && groupMembers && seededGroupId !== form.groupId) {
    setSeededGroupId(form.groupId)
    setForm((f) => ({
      ...f,
      attendees: groupMembers.map((m) => m.user as PickedUser),
    }))
  }
  const memberIds = new Set(groupMembers?.map((m) => m.user.id))
  const allMembersInvited =
    !isEdit &&
    Boolean(form.groupId) &&
    memberIds.size > 0 &&
    form.attendees.filter((a) => memberIds.has(a.id)).length >= memberIds.size

  const startAt = form.allDay
    ? startOfDay(parse(form.startDate, DATE, new Date()))
    : parse(
        `${form.startDate} ${form.startTime}`,
        `${DATE} ${TIME}`,
        new Date()
      )
  const endAt = form.allDay
    ? endOfDay(parse(form.endDate, DATE, new Date()))
    : parse(`${form.endDate} ${form.endTime}`, `${DATE} ${TIME}`, new Date())
  const validDates =
    !Number.isNaN(startAt.getTime()) && !Number.isNaN(endAt.getTime())
  const titleError = form.title.trim()
    ? null
    : t("calendar.dialog.titleRequired")
  const rangeError = !validDates
    ? t("calendar.dialog.invalidRange")
    : endAt < startAt
      ? t("calendar.dialog.endBeforeStart")
      : null

  // moving the start keeps the duration (like Google Calendar)
  const changeStart = (date: string, time: string) => {
    const next = parse(`${date} ${time}`, `${DATE} ${TIME}`, new Date())
    if (Number.isNaN(next.getTime()) || !validDates) {
      setForm((f) => ({ ...f, startDate: date, startTime: time }))
      return
    }
    const oldStart = form.allDay ? startOfDay(startAt) : startAt
    const duration = Math.max(0, endAt.getTime() - oldStart.getTime())
    const end = new Date(
      (form.allDay ? startOfDay(next) : next).getTime() + duration
    )
    setForm((f) => ({
      ...f,
      startDate: date,
      startTime: time,
      endDate: format(end, DATE),
      ...(f.allDay ? {} : { endTime: format(end, TIME) }),
    }))
  }

  const save = async () => {
    setSubmitted(true)
    if (titleError || rangeError) return
    setSaving(true)
    const fields = {
      title: form.title.trim(),
      type: form.type,
      allDay: form.allDay,
      startAt,
      endAt,
      location: form.location.trim() || null,
      description: form.description.trim() || null,
      rrule: buildRrule(form.repeat, startAt),
      hasVideoCall: form.hasVideoCall,
    }
    try {
      let id: string
      if (event) {
        await db.event.update({ where: { id: event.id }, data: fields })
        const before = new Set(event.attendees.map((a) => a.userId))
        const after = new Set(form.attendees.map((a) => a.id))
        const added = [...after].filter((id) => !before.has(id))
        const removed = [...before].filter(
          (id) => !after.has(id) && id !== event.creatorId
        )
        await Promise.all(
          added.map((userId) =>
            db.eventAttendee.create({ data: { eventId: event.id, userId } })
          )
        )
        if (removed.length) {
          await db.eventAttendee.deleteMany({
            where: { eventId: event.id, userId: { in: removed } },
          })
        }
        id = event.id
      } else {
        const groupId = form.groupId || null
        const attendees = {
          create: [
            { userId: me.id, rsvp: "GOING" as const },
            ...form.attendees.map((u) => ({ userId: u.id })),
          ],
        }
        // group events are announced in the group's feed as a Post(type EVENT)
        const created = groupId
          ? await db.event.create({
              data: {
                ...fields,
                group: { connect: { id: groupId } },
                post: {
                  create: {
                    group: { connect: { id: groupId } },
                    type: "EVENT",
                    content: fields.description ?? "",
                  },
                },
                attendees,
              },
              select: { id: true },
            })
          : await db.event.create({
              data: { ...fields, attendees },
              select: { id: true },
            })
        id = created.id
      }
      await invalidateModels(queryClient, [
        "event",
        "eventAttendee",
        ...(form.groupId ? (["post"] as const) : []),
      ])
      toast.success(
        isEdit ? t("calendar.dialog.updated") : t("calendar.dialog.created")
      )
      onSaved?.(id)
      onOpenChange(false)
    } catch (err) {
      toast.error(t("calendar.dialog.saveFailed"), {
        description: errorMessage(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-xl">
        <ScrollArea
          className="rounded-[inherit]"
          viewportClassName="max-h-[90svh]"
        >
          <div className="grid gap-6 p-6">
            <DialogHeader>
              <DialogTitle>
                {isEdit
                  ? t("calendar.dialog.editTitle")
                  : t("calendar.dialog.newTitle")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {isEdit
                  ? t("calendar.dialog.editDescription")
                  : t("calendar.dialog.newDescription")}
              </DialogDescription>
            </DialogHeader>
            <form
              id="event-form"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <FieldGroup className="gap-4">
                <Field data-invalid={submitted && Boolean(titleError)}>
                  <FieldLabel htmlFor="event-title">
                    {t("calendar.dialog.title")}
                  </FieldLabel>
                  <Input
                    id="event-title"
                    autoFocus
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder={t("calendar.dialog.titlePlaceholder")}
                    maxLength={200}
                    aria-invalid={submitted && Boolean(titleError)}
                  />
                  {submitted && titleError ? (
                    <FieldError>{titleError}</FieldError>
                  ) : null}
                </Field>

                <Field>
                  <FieldLabel>{t("calendar.dialog.type")}</FieldLabel>
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="radiogroup"
                    aria-label={t("calendar.dialog.eventType")}
                  >
                    {EVENT_TYPES.map((type) => {
                      const style = EVENT_TYPE_STYLES[type]
                      const Icon = style.icon
                      const active = form.type === type
                      return (
                        <Button
                          key={type}
                          type="button"
                          size="sm"
                          variant={active ? "secondary" : "outline"}
                          role="radio"
                          aria-checked={active}
                          onClick={() => set("type", type)}
                          className={active ? "ring-2 ring-ring/40" : undefined}
                        >
                          <span
                            className={`size-2 rounded-full ${style.dot}`}
                            aria-hidden
                          />
                          <Icon />
                          {t(eventTypeLabelKey(type))}
                        </Button>
                      )
                    })}
                  </div>
                </Field>

                <div className="flex items-center gap-2">
                  <Switch
                    id="event-all-day"
                    checked={form.allDay}
                    onCheckedChange={(v) => set("allDay", v)}
                  />
                  <Label htmlFor="event-all-day" className="font-normal">
                    {t("calendar.allDay")}
                  </Label>
                </div>

                <Field data-invalid={submitted && Boolean(rangeError)}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor="event-start-date">
                        {t("calendar.dialog.starts")}
                      </FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          id="event-start-date"
                          type="date"
                          value={form.startDate}
                          onChange={(e) =>
                            changeStart(e.target.value, form.startTime)
                          }
                          required
                        />
                        {form.allDay ? null : (
                          <Input
                            type="time"
                            aria-label={t("calendar.dialog.startTime")}
                            value={form.startTime}
                            onChange={(e) =>
                              changeStart(form.startDate, e.target.value)
                            }
                            className="w-40"
                            step={300}
                            required
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor="event-end-date">
                        {t("calendar.dialog.ends")}
                      </FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          id="event-end-date"
                          type="date"
                          value={form.endDate}
                          min={form.startDate}
                          onChange={(e) => set("endDate", e.target.value)}
                          aria-invalid={submitted && Boolean(rangeError)}
                          required
                        />
                        {form.allDay ? null : (
                          <Input
                            type="time"
                            aria-label={t("calendar.dialog.endTime")}
                            value={form.endTime}
                            onChange={(e) => set("endTime", e.target.value)}
                            className="w-40"
                            step={300}
                            aria-invalid={submitted && Boolean(rangeError)}
                            required
                          />
                        )}
                      </div>
                    </div>
                  </div>
                  {rangeError && (submitted || validDates) ? (
                    <FieldError>{rangeError}</FieldError>
                  ) : null}
                </Field>

                <Field>
                  <FieldLabel htmlFor="event-repeat">
                    {t("calendar.dialog.repeat")}
                  </FieldLabel>
                  <NativeSelect
                    id="event-repeat"
                    value={form.repeat}
                    onChange={(e) =>
                      set("repeat", e.target.value as RepeatOption)
                    }
                    className="w-full sm:w-72"
                  >
                    {REPEAT_OPTIONS.map((option) => (
                      <NativeSelectOption key={option} value={option}>
                        {repeatLabel(option, validDates ? startAt : new Date())}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>

                <Field>
                  <FieldLabel htmlFor="event-location">
                    {t("calendar.dialog.location")}
                  </FieldLabel>
                  <Input
                    id="event-location"
                    value={form.location}
                    onChange={(e) => set("location", e.target.value)}
                    placeholder={t("calendar.dialog.locationPlaceholder")}
                    maxLength={300}
                  />
                </Field>

                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="flex flex-col">
                    <Label htmlFor="event-video">
                      {t("calendar.dialog.addVideo")}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {t("calendar.dialog.addVideoHint")}
                    </span>
                  </div>
                  <Switch
                    id="event-video"
                    checked={form.hasVideoCall}
                    onCheckedChange={(v) => set("hasVideoCall", v)}
                  />
                </div>

                <Field>
                  <FieldLabel>{t("calendar.dialog.guests")}</FieldLabel>
                  <PeoplePicker
                    value={form.attendees}
                    onChange={(users) => set("attendees", users)}
                    excludeIds={[event?.creatorId ?? me.id]}
                    hideAdd={allMembersInvited}
                  />
                </Field>

                {isEdit || defaults?.group ? (
                  (event?.group ?? defaults?.group) ? (
                    <p className="text-sm text-muted-foreground">
                      {t("calendar.dialog.postedIn", {
                        name: (event?.group ?? defaults?.group)?.name,
                      })}
                    </p>
                  ) : null
                ) : (
                  <Field>
                    <FieldLabel htmlFor="event-group">
                      {t("calendar.dialog.group")}
                    </FieldLabel>
                    <NativeSelect
                      id="event-group"
                      value={form.groupId}
                      onChange={(e) => set("groupId", e.target.value)}
                      className="w-full sm:w-72"
                    >
                      <NativeSelectOption value="">
                        {t("calendar.dialog.noGroup")}
                      </NativeSelectOption>
                      {groups.map((g) => (
                        <NativeSelectOption key={g.id} value={g.id}>
                          {g.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    {form.groupId ? (
                      <span className="text-xs text-muted-foreground">
                        {t("calendar.dialog.groupHint")}
                      </span>
                    ) : null}
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="event-description">
                    {t("calendar.dialog.description")}
                  </FieldLabel>
                  <Textarea
                    id="event-description"
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder={t("calendar.dialog.descriptionPlaceholder")}
                    rows={4}
                    maxLength={5000}
                  />
                </Field>
              </FieldGroup>
            </form>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" form="event-form" disabled={saving}>
                {saving ? <Spinner /> : null}
                {isEdit ? t("common.save") : t("common.create")}
              </Button>
            </DialogFooter>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
