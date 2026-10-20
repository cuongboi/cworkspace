import { cn } from "cn";
import { ThumbsUpIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReactionType } from "@app/api/zenstack/models";
import { ScrollArea } from "@/components/ui/scroll-area";

export const REACTIONS: {
  type: ReactionType;
  emoji: string;
  /** text color used for the "my reaction" label */
  tone: string;
}[] = [
  { type: ReactionType.LIKE, emoji: "👍", tone: "text-primary" },
  {
    type: ReactionType.LOVE,
    emoji: "❤️",
    tone: "text-rose-500",
  },
  {
    type: ReactionType.HAHA,
    emoji: "😆",
    tone: "text-amber-500",
  },
  { type: ReactionType.WOW, emoji: "😮", tone: "text-amber-500" },
  { type: ReactionType.SAD, emoji: "😢", tone: "text-amber-500" },
  {
    type: ReactionType.ANGRY,
    emoji: "😡",
    tone: "text-orange-600",
  },
];

export const reactionMeta = (type: ReactionType) =>
  REACTIONS.find((r) => r.type === type) ?? (REACTIONS[0] as (typeof REACTIONS)[number]);

export type ReactionRow = {
  type: ReactionType;
  userId: string;
  user: { id: string; name: string };
};

/** Applies my pending (optimistic) reaction on top of the server rows. */
export function withOptimistic(
  rows: ReactionRow[],
  me: { id: string; name: string },
  pending: ReactionType | null | undefined,
): ReactionRow[] {
  if (pending === undefined) return rows;
  const others = rows.filter((r) => r.userId !== me.id);
  return pending ? [...others, { type: pending, userId: me.id, user: me }] : others;
}

/** Row of emoji buttons; used inside the hover card and the popover. */
export function ReactionPicker({
  current,
  onPick,
}: {
  current: ReactionType | null;
  onPick: (type: ReactionType) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t("feed.reactions.label")}
      className="flex items-center gap-0.5"
    >
      {REACTIONS.map((r) => (
        <button
          key={r.type}
          type="button"
          title={t(`feed.reactions.${r.type}`)}
          aria-label={t(`feed.reactions.${r.type}`)}
          aria-pressed={current === r.type}
          onClick={() => onPick(r.type)}
          className={cn(
            "flex size-10 items-center justify-center rounded-full text-2xl transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            current === r.type && "bg-accent",
          )}
        >
          <span aria-hidden>{r.emoji}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The "Like" action: click toggles a like (or removes my current reaction), hovering shows the
 * picker; the smile button opens the same picker for touch and keyboard users.
 */
export function ReactionButton({
  current,
  onChange,
  size = "default",
}: {
  current: ReactionType | null;
  onChange: (type: ReactionType | null) => void;
  size?: "default" | "compact";
}) {
  const { t } = useTranslation();
  const [hoverOpen, setHoverOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const meta = current ? reactionMeta(current) : null;
  const pick = (type: ReactionType) => {
    setHoverOpen(false);
    setPopoverOpen(false);
    onChange(current === type ? null : type);
  };

  if (size === "compact") {
    return (
      <HoverCard open={hoverOpen} onOpenChange={setHoverOpen} openDelay={350} closeDelay={150}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={() => onChange(current ? null : ReactionType.LIKE)}
            className={cn(
              "font-semibold hover:underline",
              meta ? meta.tone : "text-muted-foreground",
            )}
          >
            {t(`feed.reactions.${meta ? meta.type : ReactionType.LIKE}`)}
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="start" className="w-auto rounded-full p-1">
          <ReactionPicker current={current} onPick={pick} />
        </HoverCardContent>
      </HoverCard>
    );
  }

  return (
    <div className="flex flex-1 items-center">
      <HoverCard open={hoverOpen} onOpenChange={setHoverOpen} openDelay={350} closeDelay={150}>
        <HoverCardTrigger asChild>
          <Button
            variant="ghost"
            className={cn("flex-1 font-semibold", meta ? meta.tone : "text-muted-foreground")}
            aria-pressed={Boolean(current)}
            onClick={() => onChange(current ? null : ReactionType.LIKE)}
          >
            {meta ? (
              <span aria-hidden className="text-base leading-none">
                {meta.emoji}
              </span>
            ) : (
              <ThumbsUpIcon />
            )}
            {t(`feed.reactions.${meta ? meta.type : ReactionType.LIKE}`)}
          </Button>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="start" className="w-auto rounded-full p-1">
          <ReactionPicker current={current} onPick={pick} />
        </HoverCardContent>
      </HoverCard>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverContent side="top" align="start" className="w-auto rounded-full p-1">
          <ReactionPicker current={current} onPick={pick} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Top emojis + total; opens a list of who reacted with what. */
export function ReactionSummary({
  reactions,
  className,
  compact = false,
}: {
  reactions: ReactionRow[];
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (reactions.length === 0) return null;
  const counts = new Map<ReactionType, number>();
  for (const r of reactions) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const label = t("feed.reactions.count", { count: reactions.length });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("feed.reactions.seeWho", { label })}
          className={cn(
            "inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline",
            compact &&
              "rounded-full bg-background px-1.5 py-0.5 text-xs shadow-raised ring-1 ring-border hover:no-underline",
            className,
          )}
        >
          <span className="flex -space-x-1" aria-hidden>
            {top.slice(0, 3).map(([type]) => (
              <span
                key={type}
                className={cn(
                  "flex items-center justify-center rounded-full bg-background ring-2 ring-background",
                  compact ? "text-xs" : "text-sm",
                )}
              >
                {reactionMeta(type).emoji}
              </span>
            ))}
          </span>
          <span>{reactions.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2 p-3">
        <div className="flex flex-wrap gap-2 border-b pb-2 text-sm">
          {top.map(([type, count]) => (
            <span key={type} className="inline-flex items-center gap-1">
              <span aria-hidden>{reactionMeta(type).emoji}</span>
              <span className="sr-only">{t(`feed.reactions.${type}`)}</span>
              {count}
            </span>
          ))}
        </div>
        <ScrollArea viewportClassName="max-h-60">
          <ul className="flex flex-col gap-1.5 text-sm">
            {reactions.map((r) => (
              <li key={r.userId} className="flex items-center justify-between gap-2">
                <span className="truncate">{r.user.name}</span>
                <span>
                  <span aria-hidden>{reactionMeta(r.type).emoji}</span>
                  <span className="sr-only">{t(`feed.reactions.${r.type}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
