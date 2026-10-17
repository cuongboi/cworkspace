import { useQueryClient } from "@tanstack/react-query"
import { addHours, endOfDay, format, parse, startOfDay } from "date-fns"
import { useState } from "react"
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
import { useOrg } from "@/hooks/use-org"
import { db } from "@/lib/api-client"
import { invalidateModels, useDbQuery } from "@/lib/query"
import type { EventType } from "@app/api/zenstack/models"
import {
  buildRrule,
  type CalendarEvent,
  parseRepeat,
  type RepeatOption,
  repeatLabel,
} from "./calendar-utils"
import { EVENT_TYPE_STYLES, EVENT_TYPES } from "./event-colors"
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
  const end = event?.endAt ?? addHours(start, 1)
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
  const { org, me } = useOrg()
  const queryClient = useQueryClient()
  const isEdit = Boolean(event)
  const [form, setForm] = useState(() => initialState(event, defaults, me.id))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const { data: groups = [] } = useDbQuery(
    ["group", "findMany", "event-dialog", org.id, me.id],
    () =>
      db.group.findMany({
        where: {
          organizationId: org.id,
          members: { some: { userId: me.id, status: "ACTIVE" } },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    { enabled: open && !isEdit && !defaults?.group, staleTime: 60_000 }
  )

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
  const titleError = form.title.trim() ? null : "Add a title"
  const rangeError = !validDates
    ? "Pick a valid start and end"
    : endAt < startAt
      ? "The event must end after it starts"
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
                organization: { connect: { id: org.id } },
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
              data: { ...fields, organizationId: org.id, attendees },
              select: { id: true },
            })
        id = created.id
      }
      await invalidateModels(queryClient, [
        "event",
        "eventAttendee",
        ...(form.groupId ? (["post"] as const) : []),
      ])
      toast.success(isEdit ? "Event updated" : "Event created")
      onSaved?.(id)
      onOpenChange(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the event"
      )
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
              <DialogTitle>{isEdit ? "Edit event" : "New event"}</DialogTitle>
              <DialogDescription className="sr-only">
                {isEdit
                  ? "Change the details of this event"
                  : "Schedule a meeting, event, reminder or time off"}
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
                  <FieldLabel htmlFor="event-title">Title</FieldLabel>
                  <Input
                    id="event-title"
                    autoFocus
                    value={form.title}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder="Add title"
                    maxLength={200}
                    aria-invalid={submitted && Boolean(titleError)}
                  />
                  {submitted && titleError ? (
                    <FieldError>{titleError}</FieldError>
                  ) : null}
                </Field>

                <Field>
                  <FieldLabel>Type</FieldLabel>
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="radiogroup"
                    aria-label="Event type"
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
                          {style.label}
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
                    All day
                  </Label>
                </div>

                <Field data-invalid={submitted && Boolean(rangeError)}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor="event-start-date">Starts</FieldLabel>
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
                            aria-label="Start time"
                            value={form.startTime}
                            onChange={(e) =>
                              changeStart(form.startDate, e.target.value)
                            }
                            className="w-32"
                            step={300}
                            required
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor="event-end-date">Ends</FieldLabel>
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
                            aria-label="End time"
                            value={form.endTime}
                            onChange={(e) => set("endTime", e.target.value)}
                            className="w-32"
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
                  <FieldLabel htmlFor="event-repeat">Repeat</FieldLabel>
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
                  <FieldLabel htmlFor="event-location">Location</FieldLabel>
                  <Input
                    id="event-location"
                    value={form.location}
                    onChange={(e) => set("location", e.target.value)}
                    placeholder="Add a room or address"
                    maxLength={300}
                  />
                </Field>

                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="flex flex-col">
                    <Label htmlFor="event-video">Add video call</Label>
                    <span className="text-xs text-muted-foreground">
                      Attendees can join from the event.
                    </span>
                  </div>
                  <Switch
                    id="event-video"
                    checked={form.hasVideoCall}
                    onCheckedChange={(v) => set("hasVideoCall", v)}
                  />
                </div>

                <Field>
                  <FieldLabel>Guests</FieldLabel>
                  <PeoplePicker
                    value={form.attendees}
                    onChange={(users) => set("attendees", users)}
                    excludeIds={[event?.creatorId ?? me.id]}
                  />
                </Field>

                {isEdit || defaults?.group ? (
                  (event?.group ?? defaults?.group) ? (
                    <p className="text-sm text-muted-foreground">
                      Posted in {(event?.group ?? defaults?.group)?.name}
                    </p>
                  ) : null
                ) : (
                  <Field>
                    <FieldLabel htmlFor="event-group">Group</FieldLabel>
                    <NativeSelect
                      id="event-group"
                      value={form.groupId}
                      onChange={(e) => set("groupId", e.target.value)}
                      className="w-full sm:w-72"
                    >
                      <NativeSelectOption value="">
                        No group (private)
                      </NativeSelectOption>
                      {groups.map((g) => (
                        <NativeSelectOption key={g.id} value={g.id}>
                          {g.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    {form.groupId ? (
                      <span className="text-xs text-muted-foreground">
                        The event will be announced in the group's feed and
                        visible to its members.
                      </span>
                    ) : null}
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="event-description">
                    Description
                  </FieldLabel>
                  <Textarea
                    id="event-description"
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder="Add a description"
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
                Cancel
              </Button>
              <Button type="submit" form="event-form" disabled={saving}>
                {saving ? <Spinner /> : null}
                {isEdit ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
