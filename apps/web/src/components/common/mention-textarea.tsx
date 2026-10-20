import { cn } from "cn";
import { UsersRoundIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent,
  type Ref,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Mention, MentionContent, MentionInput, MentionItem } from "@/components/ui/mention";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/hooks/use-app";
import { db } from "@/lib/api-client";
import { EVERYONE_ID, formatMention, MENTION_RE } from "@/lib/mentions";
import { useDbQuery } from "@/lib/query";
import { UserAvatar } from "./user-avatar";

/**
 * Textarea with @mention autocomplete over the company's members. Users see "@Name"; the value
 * reported through `onChange` is serialized with `@[Name](userId)` tokens (see `@/lib/mentions`).
 * Pass `value=""` to reset after submitting.
 */

type Props = Omit<ComponentProps<typeof Textarea>, "value" | "onChange" | "onSubmit"> & {
  value: string;
  onChange: (serialized: string) => void;
  /** Enter submits (Shift+Enter for a newline) */
  onSubmit?: () => void;
  /** limit suggestions to these people (e.g. a chat's members) instead of the whole company */
  people?: Person[];
  /** offer `@everyone` first (group chats) */
  everyone?: boolean;
  /** imperative handle: open the suggestions as if "@" was typed (toolbar button) */
  controlRef?: Ref<MentionTextareaHandle>;
};

type Person = { id: string; name: string; image: string | null };

export type MentionTextareaHandle = { openMention: () => void };

const EVERYONE: Person = { id: EVERYONE_ID, name: "everyone", image: null };

type Mention = { name: string; userId: string };

// "[" / "]" would break the `@[Name](id)` token
const cleanName = (name: string) => name.replace(/[[\]]/g, "");

function deserialize(value: string): { display: string; mentions: Mention[] } {
  const mentions: Mention[] = [];
  const display = value.replace(MENTION_RE, (_, name: string, userId: string) => {
    mentions.push({ name, userId });
    return `@${name}`;
  });
  return { display, mentions };
}

function serialize(display: string, mentions: Mention[]) {
  let out = display;
  // longest names first so "@Ann Lee" wins over "@Ann"
  for (const m of [...mentions].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${m.name}`).join(formatMention(m.name, m.userId));
  }
  return out;
}

export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  className,
  onKeyDown,
  people,
  everyone = false,
  controlRef,
  ...props
}: Props) {
  const { t } = useTranslation();
  const { me } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState(() => ({
    ...deserialize(value),
    serialized: value,
  }));
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  // external reset / replace (e.g. cleared after submit, or editing another item)
  if (value !== state.serialized) setState({ ...deserialize(value), serialized: value });

  const { data: companyPeople = [] } = useDbQuery(
    ["user", "findMany", "mention", term],
    () =>
      db.user.findMany({
        where: {
          id: { not: me.id },
          ...(term ? { name: { contains: term, mode: "insensitive" } } : {}),
        },
        select: { id: true, name: true, image: true },
        orderBy: { name: "asc" },
        take: 6,
      }),
    { enabled: open && !people, staleTime: 60_000 },
  );
  const lower = term.toLowerCase();
  const candidates: Person[] = people
    ? [
        ...(everyone && "everyone".startsWith(lower) ? [EVERYONE] : []),
        ...people.filter((p) => p.id !== me.id && p.name.toLowerCase().includes(lower)).slice(0, 8),
      ]
    : companyPeople;

  // diceui reports the text and the picked ids back-to-back on select; keep the latest across both
  const latest = useRef(state);
  latest.current = state;

  const update = (display: string, mentions: Mention[]) => {
    const kept = mentions.filter((m) => display.includes(`@${m.name}`));
    const next = { display, mentions: kept, serialized: serialize(display, kept) };
    latest.current = next;
    setState(next);
    onChange(next.serialized);
  };

  // the search term after the last "@" before the caret; suggestions are filtered by us (or the API)
  const detectTerm = (text: string) => {
    const caret = ref.current?.selectionStart ?? text.length;
    const match = /(^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret));
    setTerm(match?.[2] ?? "");
  };

  useImperativeHandle(controlRef, () => ({
    openMention: () => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const caret = el.selectionStart ?? el.value.length;
      const before = el.value.slice(0, caret);
      const prefix = before && !/\s$/.test(before) ? " @" : "@";
      // insert as if typed: diceui anchors and opens the menu only from its own input handlers
      // (setting `open` directly leaves the popover at 0,0); also keeps native undo
      if (!document.execCommand("insertText", false, prefix)) {
        const next = `${before}${prefix}${el.value.slice(el.selectionEnd ?? caret)}`;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, next);
        el.setSelectionRange(caret + prefix.length, caret + prefix.length);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    },
  }));

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // while the menu is open, Enter/arrows belong to the mention list
    if (!open && onSubmit && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <Mention
      className="relative w-full"
      trigger="@"
      open={open}
      onOpenChange={setOpen}
      inputValue={state.display}
      onInputValueChange={(display) => {
        update(display, latest.current.mentions);
        detectTerm(display);
      }}
      value={state.mentions.map((m) => m.userId)}
      onValueChange={(ids) => {
        const { display, mentions } = latest.current;
        const added = ids
          .filter((id) => !mentions.some((m) => m.userId === id))
          .map((id) => candidates.find((p) => p.id === id))
          .filter((p): p is Person => !!p)
          .map((p) => ({ name: cleanName(p.name), userId: p.id }));
        update(display, [...mentions.filter((m) => ids.includes(m.userId)), ...added]);
      }}
      onFilter={(options) => options}
    >
      <MentionInput asChild>
        <Textarea
          ref={ref}
          onKeyDown={handleKeyDown}
          className={cn("resize-none", className)}
          {...props}
        />
      </MentionInput>
      {candidates.length > 0 ? (
        <MentionContent className="w-64">
          {candidates.map((user) => (
            <MentionItem key={user.id} value={user.id} label={cleanName(user.name)}>
              {user.id === EVERYONE_ID ? (
                <>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UsersRoundIcon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {t("feed.mention.everyone")}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {t("feed.mention.everyoneHint")}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <UserAvatar user={user} size="sm" />
                  <span className="truncate">{user.name}</span>
                </>
              )}
            </MentionItem>
          ))}
        </MentionContent>
      ) : null}
    </Mention>
  );
}
