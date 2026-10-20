import { useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { AtSignIcon, PaperclipIcon, ThumbsUpIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AttachmentList } from "@/components/common/attachment-list";
import { MentionTextarea, type MentionTextareaHandle } from "@/components/common/mention-textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApp } from "@/hooks/use-app";
import { useSocket } from "@/hooks/use-socket";
import type { useUploads } from "@/hooks/use-uploads";
import { ApiError, db } from "@/lib/api-client";
import { toPlainText } from "@/lib/mentions";
import {
  type ChatMessage,
  findCachedMessage,
  insertMessage,
  messageInclude,
  messagesKey,
  patchMessage,
  removeMessage,
  replaceMessage,
  tempId,
} from "./chat-data";
import { useThreadScroll } from "./thread-scroll";
import { ScrollArea } from "@/components/ui/scroll-area";

export type ComposerMode =
  | { kind: "reply"; message: ChatMessage }
  | { kind: "edit"; message: ChatMessage };

type Props = {
  conversationId: string;
  mode: ComposerMode | null;
  onModeChange: (mode: ComposerMode | null) => void;
  uploads: ReturnType<typeof useUploads>;
  /** who can be @mentioned; mentions are offered in group chats only */
  members: { id: string; name: string; image: string | null }[];
  isGroup: boolean;
  disabled?: boolean;
};

const TYPING_THROTTLE_MS = 2000;

export function Composer({
  conversationId,
  mode,
  onModeChange,
  uploads,
  members,
  isGroup,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const { me } = useApp();
  const qc = useQueryClient();
  const socket = useSocket();
  const { scrollToEnd } = useThreadScroll();
  const [value, setValue] = useState("");
  const [draft, setDraft] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mentionRef = useRef<MentionTextareaHandle>(null);
  const lastTypingRef = useRef(0);

  // entering edit mode loads the message into the box; leaving it restores the draft
  const editingId = mode?.kind === "edit" ? mode.message.id : null;
  const [prevEditingId, setPrevEditingId] = useState<string | null>(null);
  if (editingId !== prevEditingId) {
    setPrevEditingId(editingId);
    if (editingId && mode?.kind === "edit") {
      if (!prevEditingId) setDraft(value);
      setValue(mode.message.content);
    } else {
      setValue(draft);
      setDraft("");
    }
  }

  const modeKey = mode ? `${mode.kind}:${mode.message.id}` : "";
  useEffect(() => {
    if (modeKey)
      requestAnimationFrame(() => wrapperRef.current?.querySelector("textarea")?.focus());
  }, [modeKey]);

  const emitTyping = (next: string) => {
    if (!socket || !next.trim() || mode?.kind === "edit") return;
    const now = Date.now();
    if (now - lastTypingRef.current < TYPING_THROTTLE_MS) return;
    lastTypingRef.current = now;
    socket.emit("typing", { conversationId });
  };

  const sendMessage = (content: string) => {
    const replyTo = mode?.kind === "reply" ? mode.message : null;
    const attachments = uploads.attachments;
    const connect = uploads.connect();
    const temp: ChatMessage = {
      id: tempId(),
      conversationId,
      senderId: me.id,
      content,
      type: "TEXT",
      data: null,
      replyToId: replyTo?.id ?? null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      sender: { id: me.id, name: me.name, image: me.image ?? null },
      attachments,
      reactions: [],
      integrationId: null,
      integration: null,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            content: replyTo.content,
            deletedAt: replyTo.deletedAt,
            senderId: replyTo.senderId,
            sender: { name: replyTo.sender.name },
          }
        : null,
      pending: true,
    };
    insertMessage(qc, temp);
    setValue("");
    uploads.reset();
    onModeChange(null);
    lastTypingRef.current = 0;
    requestAnimationFrame(() => scrollToEnd({ behavior: "smooth" }));

    db.message
      .create({
        data: {
          conversationId,
          content,
          replyToId: replyTo?.id ?? null,
          attachments: connect,
        },
        include: messageInclude,
      })
      .then((saved) => replaceMessage(qc, conversationId, temp.id, saved))
      .catch((err: unknown) => {
        removeMessage(qc, conversationId, temp.id);
        toast.error(err instanceof ApiError ? err.message : t("chat.composer.sendFailed"), {
          description: toPlainText(content).slice(0, 80) || undefined,
        });
        // give the text back if the box is still empty
        setValue((v) => (v ? v : content));
      });
  };

  const saveEdit = (message: ChatMessage, content: string) => {
    if (content === message.content) return onModeChange(null);
    const previous = { content: message.content, editedAt: message.editedAt };
    const editedAt = new Date();
    patchMessage(qc, conversationId, message.id, (m) => ({
      ...m,
      content,
      editedAt,
    }));
    onModeChange(null);
    db.message
      .update({
        where: { id: message.id },
        data: { content, editedAt },
        select: { id: true },
      })
      .catch((err: unknown) => {
        patchMessage(qc, conversationId, message.id, (m) => ({
          ...m,
          ...previous,
        }));
        toast.error(err instanceof ApiError ? err.message : t("chat.composer.editFailed"));
      });
  };

  const submit = () => {
    if (disabled) return;
    const content = value.trim();
    if (mode?.kind === "edit") {
      if (!content) return void toast.error(t("chat.composer.emptyEdit"));
      return saveEdit(mode.message, content);
    }
    if (uploads.uploading) return void toast(t("chat.composer.stillUploading"));
    if (!content && uploads.attachments.length === 0) return;
    sendMessage(content);
  };

  const editLastOwn = () => {
    const data = qc.getQueryData<{ pages: ChatMessage[][] }>(messagesKey(conversationId));
    const mineLatest = data?.pages
      .flat()
      .find(
        (m) =>
          m.senderId === me.id &&
          m.type === "TEXT" &&
          !m.deletedAt &&
          !m.pending &&
          m.content.trim(),
      );
    if (mineLatest) onModeChange({ kind: "edit", message: mineLatest });
  };

  const canSend =
    mode?.kind === "edit"
      ? value.trim().length > 0
      : value.trim().length > 0 || uploads.attachments.length > 0;
  const quoted = mode
    ? (findCachedMessage(qc, conversationId, mode.message.id) ?? mode.message)
    : null;

  const discard = () => {
    setValue("");
    for (const a of uploads.attachments) uploads.remove(a.id);
    onModeChange(null);
  };
  const dirty = value.trim().length > 0 || uploads.attachments.length > 0 || mode !== null;
  const sending = uploads.uploading && mode?.kind !== "edit";

  return (
    <div
      ref={wrapperRef}
      className="w-full shrink-0 bg-background px-3 pt-1 pb-4 md:px-6 md:pb-6"
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files);
        if (files.length === 0 || mode?.kind === "edit") return;
        e.preventDefault();
        void uploads.add(files);
      }}
    >
      <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-3.5 transition-colors focus-within:border-ring">
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs text-muted-foreground">
            {mode?.kind === "edit"
              ? t("chat.composer.editing")
              : mode?.kind === "reply"
                ? t("chat.composer.reply")
                : t("chat.composer.message")}
          </p>
          {mode ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="-my-1 text-muted-foreground"
              onClick={() => onModeChange(null)}
              aria-label={
                mode.kind === "edit"
                  ? t("chat.composer.cancelEditing")
                  : t("chat.composer.cancelReply")
              }
            >
              <XIcon />
            </Button>
          ) : null}
        </div>

        {mode && quoted ? (
          <div className="flex gap-2 border-l-2 pl-2 text-2xs leading-normal">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {quoted.senderId === me.id ? t("common.you") : quoted.sender.name}
              </p>
              <p className="truncate text-muted-foreground">
                {mode.kind === "edit"
                  ? t("chat.composer.editHint")
                  : toPlainText(quoted.content) ||
                    (quoted.attachments.length ? t("chat.composer.attachment") : "")}
              </p>
            </div>
          </div>
        ) : null}

        {mode?.kind !== "edit" && (uploads.attachments.length > 0 || uploads.pending.length > 0) ? (
          <ScrollArea viewportClassName="max-h-56">
            <div className="flex flex-col gap-2">
              <AttachmentList
                attachments={uploads.attachments}
                onRemove={uploads.remove}
                className="max-w-sm"
              />
              {uploads.pending.map((p) => (
                <div key={p.key} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  <span className="truncate">{t("chat.composer.uploading", { name: p.name })}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : null}

        <MentionTextarea
          controlRef={mentionRef}
          // 1:1 chats have nobody else worth tagging: no suggestions at all
          people={isGroup ? members : []}
          everyone={isGroup}
          value={value}
          onChange={(next) => {
            setValue(next);
            emitTyping(next);
          }}
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === "Escape" && mode) {
              e.preventDefault();
              onModeChange(null);
            } else if (e.key === "ArrowUp" && !value && !mode) {
              e.preventDefault();
              editLastOwn();
            }
          }}
          placeholder={disabled ? t("chat.composer.cantSend") : t("chat.composer.placeholder")}
          aria-label={t("chat.composer.message")}
          rows={2}
          disabled={disabled}
          className={cn(
            "field-sizing-content max-h-40 min-h-10 rounded-none border-0 bg-transparent p-0 text-xs leading-relaxed shadow-none md:text-xs",
            "focus-visible:ring-0 dark:bg-transparent",
          )}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            {mode?.kind !== "edit" ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.length) void uploads.add(e.target.files);
                    e.target.value = "";
                  }}
                />
                <ToolButton
                  label={t("chat.composer.attach")}
                  disabled={disabled}
                  onClick={() => fileRef.current?.click()}
                >
                  <PaperclipIcon />
                </ToolButton>
              </>
            ) : null}
            {isGroup ? (
              <ToolButton
                label={t("chat.composer.mention")}
                disabled={disabled}
                onClick={() => mentionRef.current?.openMention()}
              >
                <AtSignIcon />
              </ToolButton>
            ) : null}
            {mode?.kind !== "edit" ? (
              <ToolButton
                label={t("chat.composer.sendLike")}
                disabled={disabled || uploads.uploading}
                onClick={() => sendMessage("👍")}
              >
                <ThumbsUpIcon />
              </ToolButton>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            {dirty ? (
              <Button variant="outline" size="xs" onClick={discard}>
                {mode?.kind === "edit" ? t("common.cancel") : t("chat.composer.discard")}
              </Button>
            ) : null}
            <Button size="xs" onClick={submit} disabled={!canSend || disabled || sending}>
              {sending ? <Spinner /> : null}
              {mode?.kind === "edit" ? t("common.save") : t("common.send")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          // keep the textarea focused so its caret (and mention query) survive the click
          onMouseDown={(e) => e.preventDefault()}
          className="[&_svg:not([class*='size-'])]:size-3.75"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
