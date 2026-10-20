import { cn } from "cn"
import {
  ArrowLeftIcon,
  CaptionsIcon,
  EllipsisIcon,
  MessageSquareIcon,
  PhoneIcon,
  PhoneOffIcon,
  ScrollTextIcon,
  UsersIcon,
  VideoIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react"
import { parseAsBoolean, useQueryState } from "nuqs"
import { useNavigate } from "react-router-dom"
import { type ReactNode, useEffect, useState } from "react"
import { ChatThread } from "@/components/chat/chat-thread"
import { UserAvatar } from "@/components/common/user-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  SpeedDial,
  SpeedDialContent,
  SpeedDialItem,
  SpeedDialLabel,
  SpeedDialTrigger,
} from "@/components/ui/speed-dial"
import { Spinner } from "@/components/ui/spinner"
import { useIsMobile } from "@/hooks/use-mobile"
import { useApp } from "@/hooks/use-app"
import { useSocketEvent } from "@/hooks/use-socket"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import type { UserSummary } from "@/lib/realtime-events"
import { SELF_ID, type UseCall, useCall } from "@/lib/rtc/use-call"
import {
  CameraButton,
  CaptionsButton,
  ControlButton,
  DeviceMenu,
  LeaveButton,
  MicButton,
  ScreenButton,
} from "./call-controls"
import { CaptionsOverlay } from "./captions-overlay"
import { GlossaryDialog } from "./glossary-dialog"
import { RemoteAudio, StreamVideo } from "./media-elements"
import { ParticipantTile, type TileProps } from "./participant-tile"
import { TranscriptPanel } from "./transcript-panel"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useTranslation } from "react-i18next"

/**
 * The call page body: pre-join lobby (camera preview + toggles; the "Join" click also unlocks
 * audio autoplay), then the call grid / presentation stage, then the "Call ended" screen.
 * Render it with `key={callId}` so a different call gets a fresh session.
 */
export function CallScreen({ callId }: { callId: string }) {
  const { me } = useApp()
  const { t } = useTranslation()
  const info = useDbQuery(["call", "findUnique", callId, "lobby"], () =>
    db.call.findUnique({
      where: { id: callId },
      select: {
        type: true,
        status: true,
        conversationId: true,
        participants: {
          where: { leftAt: null },
          select: { user: { select: { id: true, name: true, image: true } } },
        },
      },
    })
  )
  const unavailable =
    info.isError ||
    (info.isSuccess && (!info.data || info.data.status === "ENDED"))
  const call = useCall(callId, unavailable ? null : (info.data?.type ?? null))
  const self: UserSummary = {
    id: me.id,
    name: me.name,
    image: me.image ?? null,
  }

  return (
    <div className="dark flex h-full min-h-0 flex-col bg-background text-foreground">
      {unavailable ? (
        <CallEnded
          reason={
            info.isError
              ? t("call.ended.unavailable")
              : t("call.ended.thisEnded")
          }
        />
      ) : call.phase === "ended" ? (
        <CallEnded reason={call.endedReason ?? t("call.ended.default")} />
      ) : info.isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      ) : call.phase === "lobby" || call.phase === "joining" ? (
        <Lobby
          call={call}
          self={self}
          inCall={info.data?.participants.map((p) => p.user) ?? []}
        />
      ) : (
        <InCall
          call={call}
          self={self}
          conversationId={info.data?.conversationId ?? null}
        />
      )}
    </div>
  )
}

function useGoBack() {
  const navigate = useNavigate()
  return () => {
    if (window.history.length > 1) navigate(-1)
    else void navigate("/chat")
  }
}

// --- lobby -------------------------------------------------------------------------------------

function Lobby({
  call,
  self,
  inCall,
}: {
  call: UseCall
  self: UserSummary
  inCall: UserSummary[]
}) {
  const goBack = useGoBack()
  const { t } = useTranslation()
  const isVideo = call.kind === "VIDEO"
  const others = inCall.filter((u) => u.id !== self.id)
  const joining = call.phase === "joining"

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="[&>div]:h-full">
      <div className="flex min-h-full items-center justify-center p-4 md:p-8">
        <div className="grid w-full max-w-4xl items-center gap-6 md:grid-cols-[3fr_2fr] md:gap-10">
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-muted/40">
            {call.camera && call.cameraStream ? (
              <StreamVideo
                stream={call.cameraStream}
                mirrored
                className="absolute inset-0"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                {call.mediaReady ? (
                  <>
                    <UserAvatar user={self} size="xl" />
                    {isVideo ? t("call.lobby.cameraOff") : t("call.audioCall")}
                  </>
                ) : (
                  <>
                    <Spinner className="size-5" />
                    {t("call.lobby.startingMedia")}
                  </>
                )}
              </div>
            )}
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-3">
              <MicButton
                on={call.mic}
                onToggle={call.toggleMic}
                disabled={!call.mediaReady}
              />
              <CameraButton
                on={call.camera}
                onToggle={call.toggleCamera}
                disabled={!call.mediaReady}
              />
              <DeviceMenu
                devices={call.devices}
                audioDeviceId={call.audioDeviceId}
                videoDeviceId={call.videoDeviceId}
                onSelect={call.selectDevice}
              />
              <CaptionsButton
                captions={call.captions}
                available={call.captionsAvailable}
                status={call.captionStatus}
                error={call.captionError}
                onChange={call.setCaptions}
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 text-center md:items-start md:text-left">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isVideo ? (
                <VideoIcon className="size-4" aria-hidden />
              ) : (
                <PhoneIcon className="size-4" aria-hidden />
              )}
              {isVideo ? t("call.videoCall") : t("call.audioCall")}
            </div>
            <h1 className="text-2xl font-semibold">{t("call.lobby.ready")}</h1>
            {others.length ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="flex -space-x-2">
                  {others.slice(0, 4).map((u) => (
                    <UserAvatar
                      key={u.id}
                      user={u}
                      size="sm"
                      className="rounded-full ring-2 ring-background"
                    />
                  ))}
                </div>
                {others.length === 1
                  ? t("call.lobby.oneInCall", { name: others[0]?.name })
                  : t("call.lobby.peopleInCall", { count: others.length })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("call.lobby.nobody")}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="lg"
                className="min-w-28"
                onClick={call.join}
                disabled={!call.connected || joining}
              >
                {joining ? <Spinner /> : null}
                {joining ? t("call.lobby.joining") : t("call.lobby.join")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={goBack}
                disabled={joining}
              >
                {t("common.cancel")}
              </Button>
            </div>
            {!call.connected ? (
              <p className="text-xs text-muted-foreground">
                {t("call.lobby.connecting")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

// --- in call -----------------------------------------------------------------------------------

type Tile = TileProps & { key: string }

function gridClass(n: number) {
  if (n <= 1) return "grid-cols-1 grid-rows-1"
  if (n === 2) return "grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1"
  if (n <= 4) return "grid-cols-2 grid-rows-2"
  return "grid-cols-2 grid-rows-3 md:grid-cols-3 md:grid-rows-2"
}

const UNSTABLE: ReadonlySet<RTCPeerConnectionState> = new Set([
  "connecting",
  "disconnected",
  "failed",
])

function InCall({
  call,
  self,
  conversationId,
}: {
  call: UseCall
  self: UserSummary
  /** calls on a conversation (DM, group chat, group drop-in) can chat alongside */
  conversationId: string | null
}) {
  const goBack = useGoBack()
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const chat = useCallChat(conversationId, self.id)
  const transcript = useTranscriptPanel()
  const [glossaryOpen, setGlossaryOpen] = useQueryState(
    "glossary",
    parseAsBoolean.withDefault(false)
  )
  const canShare =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia)

  const selfTile: Tile = {
    key: SELF_ID,
    user: self,
    label: self.name,
    stream: call.cameraStream,
    videoOn: call.camera && !call.screen,
    micOn: call.mic,
    speaking: call.speaking.has(SELF_ID),
    active: call.activeSpeaker === SELF_ID,
    mirrored: true,
    presenting: call.screen,
  }
  const remoteTiles: Tile[] = call.participants.map((p) => ({
    key: p.id,
    user: p.user,
    stream: p.stream,
    videoOn: p.media.video || p.media.screen,
    micOn: p.media.audio,
    speaking: call.speaking.has(p.id),
    active: call.activeSpeaker === p.id,
    presenting: p.media.screen,
    connecting: UNSTABLE.has(p.connection),
    fit: p.media.screen ? "contain" : "cover",
  }))

  const remotePresenter = call.participants.find(
    (p) => p.media.screen && p.stream
  )
  const presenting =
    remotePresenter ?? (call.screen && call.screenStream ? SELF_ID : null)
  const tiles = [...remoteTiles, selfTile]

  const leave = () => {
    call.leave()
    goBack()
  }

  // Secondary controls overflow the bar on phones, so there they fold into a speed dial.
  const secondary: SecondaryControl[] = [
    ...(canShare
      ? [
          {
            key: "screen",
            label: call.screen
              ? t("call.room.stopPresenting")
              : t("call.room.shareScreen"),
            control: (
              <ScreenButton
                key="screen"
                on={call.screen}
                onToggle={call.toggleScreen}
              />
            ),
          },
        ]
      : []),
    {
      key: "devices",
      label: t("call.room.audioVideo"),
      control: (
        <DeviceMenu
          key="devices"
          devices={call.devices}
          audioDeviceId={call.audioDeviceId}
          videoDeviceId={call.videoDeviceId}
          onSelect={call.selectDevice}
        />
      ),
    },
    {
      key: "captions",
      label: t("call.room.captions"),
      control: (
        <CaptionsButton
          key="captions"
          captions={call.captions}
          available={call.captionsAvailable}
          status={call.captionStatus}
          error={call.captionError}
          onChange={call.setCaptions}
          onEditGlossary={() => void setGlossaryOpen(true)}
        />
      ),
    },
    {
      key: "transcript",
      label: transcript.open
        ? t("call.room.hideTranscript")
        : t("call.room.transcript"),
      control: (
        <ControlButton
          key="transcript"
          label={
            transcript.open
              ? t("call.room.hideTranscript")
              : t("call.room.showTranscript")
          }
          aria-pressed={transcript.open}
          onClick={transcript.toggle}
        >
          <ScrollTextIcon />
        </ControlButton>
      ),
    },
    ...(conversationId
      ? [
          {
            key: "chat",
            label: chat.open ? t("call.room.hideChat") : t("call.room.chat"),
            control: (
              <ControlButton
                key="chat"
                label={
                  chat.open ? t("call.room.hideChat") : t("call.room.showChat")
                }
                aria-pressed={chat.open}
                className="relative"
                onClick={chat.toggle}
              >
                <MessageSquareIcon />
                {chat.unread ? <UnreadDot /> : null}
              </ControlButton>
            ),
          },
        ]
      : []),
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {call.participants.map((p) => (
          <RemoteAudio key={p.id} stream={p.stream} />
        ))}

        <header className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-2">
          <h1 className="min-w-0 truncate text-sm font-medium">
            {call.title ?? t("call.title")}
          </h1>
          {call.phase === "reconnecting" ? (
            <Badge variant="secondary" className="gap-1">
              <WifiOffIcon className="size-3" aria-hidden />
              {t("call.room.reconnecting")}
            </Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span
              className="flex items-center gap-1"
              title={t("call.room.participants")}
            >
              <UsersIcon className="size-3.5" aria-hidden />
              <span aria-hidden>{tiles.length}</span>
              <span className="sr-only">
                {t("call.room.participantCount", { count: tiles.length })}
              </span>
            </span>
            <Elapsed since={call.joinedAt} />
          </div>
        </header>

        <main className="relative flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 md:px-4">
          {presenting ? (
            <>
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
                <StreamVideo
                  stream={
                    presenting === SELF_ID
                      ? call.screenStream
                      : (remotePresenter?.stream ?? null)
                  }
                  fit="contain"
                  className="absolute inset-0"
                />
                <div className="absolute top-2 left-2 rounded-md bg-background/70 px-2 py-1 text-xs backdrop-blur-sm">
                  {presenting === SELF_ID
                    ? t("call.room.youPresenting")
                    : t("call.room.presenting", {
                        name: remotePresenter?.user.name,
                      })}
                </div>
              </div>
              <ScrollArea orientation="horizontal" className="shrink-0">
                <div className="flex h-24 gap-2 md:h-32">
                  {tiles
                    .filter(
                      (t) =>
                        t.key !==
                        (presenting === SELF_ID ? SELF_ID : remotePresenter?.id)
                    )
                    .map(({ key, ...tile }) => (
                      <ParticipantTile
                        key={key}
                        {...tile}
                        size="small"
                        className="aspect-video h-full shrink-0"
                      />
                    ))}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div
              className={cn(
                "grid min-h-0 flex-1 gap-2",
                gridClass(tiles.length)
              )}
            >
              {tiles.map(({ key, ...tile }) => (
                <ParticipantTile
                  key={key}
                  {...tile}
                  size={tiles.length > 4 ? "small" : "default"}
                />
              ))}
            </div>
          )}
          {call.participants.length === 0 && call.phase === "in-call" ? (
            <output className="pointer-events-none absolute inset-x-0 top-4 mx-auto w-fit rounded-full bg-background/70 px-3 py-1 text-sm text-muted-foreground backdrop-blur-sm">
              {t("call.room.waiting")}
            </output>
          ) : null}
          {call.captionsActive ? (
            <output className="pointer-events-none absolute top-4 left-4 z-10 flex max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-full bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm">
              <CaptionsIcon className="size-3.5 shrink-0" />
              <span>{t("call.room.captionsNotice")}</span>
            </output>
          ) : null}
          {call.captions.enabled ? (
            <CaptionsOverlay
              lines={call.captionLines}
              lang={call.captions.lang}
            />
          ) : null}
        </main>

        <footer className="flex shrink-0 items-center justify-center gap-3 px-4 pt-1 pb-4">
          <MicButton on={call.mic} onToggle={call.toggleMic} />
          <CameraButton on={call.camera} onToggle={call.toggleCamera} />
          {isMobile ? (
            <MoreControls unread={chat.unread} items={secondary} />
          ) : (
            secondary.map((item) => item.control)
          )}
          <LeaveButton onLeave={leave} />
        </footer>
      </div>
      <TranscriptPanel
        lines={call.transcript}
        lang={call.captions.lang}
        title={call.title}
        open={transcript.open}
        onClose={transcript.close}
      />
      <GlossaryDialog
        open={glossaryOpen}
        terms={call.glossary}
        onOpenChange={(o) => void setGlossaryOpen(o || null)}
        onSave={call.setGlossary}
      />
      {conversationId ? (
        <CallChat
          conversationId={conversationId}
          open={chat.open}
          onClose={chat.close}
        />
      ) : null}
    </div>
  )
}

type SecondaryControl = { key: string; label: string; control: ReactNode }

function UnreadDot() {
  return (
    <span className="absolute top-1 right-1 size-2.5 rounded-full bg-destructive ring-2 ring-background" />
  )
}

/**
 * Phone layout: the secondary controls behind a "…" speed dial. Content stays mounted
 * (`forceMount`) because the device and caption buttons are dropdown triggers: the dial closes on
 * the tap that opens their menu, and unmounting the trigger would close the menu with it.
 */
function MoreControls({
  items,
  unread,
}: {
  items: SecondaryControl[]
  unread: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <SpeedDial open={open} onOpenChange={setOpen}>
      <SpeedDialTrigger
        variant="secondary"
        aria-label={
          open ? t("call.room.closeMoreControls") : t("call.room.moreControls")
        }
        className="relative size-12 [&_svg:not([class*='size-'])]:size-5"
      >
        {open ? <XIcon /> : <EllipsisIcon />}
        {unread && !open ? <UnreadDot /> : null}
      </SpeedDialTrigger>
      <SpeedDialContent forceMount inert={!open}>
        {items.map((item) => (
          <SpeedDialItem key={item.key}>
            <SpeedDialLabel className="border shadow-none">
              {item.label}
            </SpeedDialLabel>
            {item.control}
          </SpeedDialItem>
        ))}
      </SpeedDialContent>
    </SpeedDial>
  )
}

/** Transcript panel open state (in the URL, `?transcript=1`). */
function useTranscriptPanel() {
  const [open, setOpen] = useQueryState(
    "transcript",
    parseAsBoolean.withDefault(false)
  )
  return {
    open,
    toggle: () => void setOpen(!open || null),
    close: () => void setOpen(null),
  }
}

/** Chat panel open state (in the URL, `?chat=1`) + an unread dot for messages while it's closed. */
function useCallChat(conversationId: string | null, meId: string) {
  const [open, setOpen] = useQueryState(
    "chat",
    parseAsBoolean.withDefault(false)
  )
  const [unread, setUnread] = useState(false)
  useSocketEvent("message:new", (m) => {
    if (!open && m.conversationId === conversationId && m.senderId !== meId)
      setUnread(true)
  })
  const show = (next: boolean) => {
    if (next) setUnread(false)
    void setOpen(next || null)
  }
  return {
    open,
    unread,
    toggle: () => show(!open),
    close: () => show(false),
  }
}

/** The conversation next to the video: a side panel on desktop, a sheet on mobile. */
function CallChat({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const close = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("call.room.closeChat")}
      onClick={onClose}
    >
      <XIcon />
    </Button>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="dark gap-0 bg-background p-0 text-foreground data-[side=bottom]:h-[80svh]"
        >
          <SheetTitle className="sr-only">{t("call.room.chat")}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("call.room.chatDescription")}
          </SheetDescription>
          <ChatThread
            conversationId={conversationId}
            variant="panel"
            actions={close}
          />
        </SheetContent>
      </Sheet>
    )
  }
  if (!open) return null
  return (
    <aside
      aria-label={t("call.room.chat")}
      className="flex w-80 shrink-0 flex-col border-l lg:w-96"
    >
      <ChatThread
        conversationId={conversationId}
        variant="panel"
        actions={close}
      />
    </aside>
  )
}

function Elapsed({ since }: { since: number | null }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  if (!since) return null
  const total = Math.max(0, Math.floor((now - since) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    <time className="tabular-nums" title={t("call.room.duration")}>
      {h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`}
    </time>
  )
}

// --- ended -------------------------------------------------------------------------------------

function CallEnded({ reason }: { reason: string }) {
  const goBack = useGoBack()
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PhoneOffIcon />
          </EmptyMedia>
          <EmptyTitle>{t("call.ended.title")}</EmptyTitle>
          <EmptyDescription>{reason}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={goBack}>
            <ArrowLeftIcon data-icon="inline-start" />
            {t("common.back")}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
