import { PlusIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"

export type PollDraft = {
  question: string
  options: { key: string; text: string }[]
  allowMultiple: boolean
  /** hours until the poll closes; 0 = never */
  durationHours: number
}

export const MAX_POLL_OPTIONS = 10

const DURATIONS = [
  { hours: 0, label: "Never closes" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
]

let keySeq = 0
const newOption = (text = "") => ({ key: `opt-${++keySeq}`, text })

export function emptyPoll(): PollDraft {
  return {
    question: "",
    options: [newOption(), newOption()],
    allowMultiple: false,
    durationHours: 0,
  }
}

export function pollIsValid(poll: PollDraft) {
  return (
    poll.question.trim().length > 0 &&
    poll.options.filter((o) => o.text.trim()).length >= 2
  )
}

/** Nested `poll: { create }` input for `db.post.create`. */
export function pollCreateInput(poll: PollDraft) {
  return {
    create: {
      question: poll.question.trim(),
      allowMultiple: poll.allowMultiple,
      closesAt: poll.durationHours
        ? new Date(Date.now() + poll.durationHours * 3_600_000)
        : null,
      options: {
        create: poll.options
          .map((o) => o.text.trim())
          .filter(Boolean)
          .map((text, order) => ({ text, order })),
      },
    },
  }
}

/** Poll editor shown inside the post composer. */
export function PollBuilder({
  value,
  onChange,
  onRemove,
}: {
  value: PollDraft
  onChange: (poll: PollDraft) => void
  onRemove: () => void
}) {
  const setOption = (key: string, text: string) =>
    onChange({
      ...value,
      options: value.options.map((o) => (o.key === key ? { ...o, text } : o)),
    })

  return (
    <fieldset className="relative flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <legend className="float-left h-6 text-sm leading-6 font-medium">
        Poll
      </legend>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-3 right-3"
        onClick={onRemove}
        aria-label="Remove poll"
      >
        <XIcon />
      </Button>
      <Input
        value={value.question}
        onChange={(e) => onChange({ ...value, question: e.target.value })}
        placeholder="Ask a question…"
        aria-label="Poll question"
        maxLength={300}
      />
      <div className="flex flex-col gap-2">
        {value.options.map((o, i) => (
          <div key={o.key} className="flex items-center gap-2">
            <Input
              value={o.text}
              onChange={(e) => setOption(o.key, e.target.value)}
              placeholder={`Option ${i + 1}`}
              aria-label={`Option ${i + 1}`}
              maxLength={120}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  i === value.options.length - 1 &&
                  value.options.length < MAX_POLL_OPTIONS
                ) {
                  e.preventDefault()
                  onChange({
                    ...value,
                    options: [...value.options, newOption()],
                  })
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={value.options.length <= 2}
              onClick={() =>
                onChange({
                  ...value,
                  options: value.options.filter((x) => x.key !== o.key),
                })
              }
              aria-label={`Remove option ${i + 1}`}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        {value.options.length < MAX_POLL_OPTIONS ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() =>
              onChange({ ...value, options: [...value.options, newOption()] })
            }
          >
            <PlusIcon />
            Add option
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="poll-multiple"
            checked={value.allowMultiple}
            onCheckedChange={(allowMultiple) =>
              onChange({ ...value, allowMultiple })
            }
          />
          <Label htmlFor="poll-multiple" className="font-normal">
            Allow multiple answers
          </Label>
        </div>
        <NativeSelect
          size="sm"
          value={String(value.durationHours)}
          onChange={(e) =>
            onChange({ ...value, durationHours: Number(e.target.value) })
          }
          aria-label="Poll duration"
        >
          {DURATIONS.map((d) => (
            <NativeSelectOption key={d.hours} value={d.hours}>
              {d.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </fieldset>
  )
}
