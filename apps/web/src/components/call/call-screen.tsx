import { cn } from "cn"
import {
  ArrowLeftIcon,
  MessageSquareIcon,
  PhoneIcon,
  PhoneOffIcon,
  UsersIcon,
  VideoIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react"
import { parseAsBoolean, useQueryState } from "nuqs"
import { useNavigate } from "react-router-dom"
import { useEffect, useState } from "react"
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
import { Spinner } from "@/components/ui/spinner"
import { useIsMobile } from "@/hooks/use-mobile"
import { useOrg } from "@/hooks/use-org"
import { useSocketEvent } from "@/hooks/use-socket"
import { db } from "@/lib/api-client"
import { useDbQuery } from "@/lib/query"
import type { UserSummary } from "@/lib/realtime-events"
import { SELF_ID, type UseCall, useCall } from "@/lib/rtc/use-call"
import {
  CameraButton,
  ControlButton,
  DeviceMenu,
  LeaveButton,
  MicButton,
  ScreenButton,
} from "./call-controls"
import { RemoteAudio, StreamVideo } from "./media-elements"
import { ParticipantTile, type TileProps } from "./participant-tile"
import { ScrollArea } from "@/components/ui/scroll-area"

/**
 * The call page body: pre-join lobby (camera preview + toggles; the "Join" click also unlocks
 * audio autoplay), then the call grid / presentation stage, then the "Call ended" screen.
 * Render it with `key={callId}` so a different call gets a fresh session.
 */
export function CallScreen({ callId }: { callId: string }) {
  const { me } = useOrg()
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
    <div className="dark flex h-[calc(100svh-3.5rem)] min-h-0 flex-col bg-background text-foreground">
      {unavailable ? (
        <CallEnded
          reason={
            info.isError ? "This call isn't available" : "This call has ended"
          }
        />
      ) : call.phase === "ended" ? (
        <CallEnded reason={call.endedReason ?? "The call has ended"} />
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
  const { href } = useOrg()
  return () => {
    if (window.history.length > 1) navigate(-1)
    else void navigate(href("/chat"))
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
                    {isVideo ? "Your camera is off" : "Audio call"}
                  </>
                ) : (
                  <>
                    <Spinner className="size-5" />
                    Starting your camera and microphone…
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
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 text-center md:items-start md:text-left">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isVideo ? (
                <VideoIcon className="size-4" aria-hidden />
              ) : (
                <PhoneIcon className="size-4" aria-hidden />
              )}
              {isVideo ? "Video call" : "Audio call"}
            </div>
            <h1 className="text-2xl font-semibold">Ready to join?</h1>
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
                  ? `${others[0]?.name} is in the call`
                  : `${others.length} people are in the call`}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No one else is here yet.
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
                {joining ? "Joining…" : "Join now"}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={goBack}
                disabled={joining}
              >
                Cancel
              </Button>
            </div>
            {!call.connected ? (
              <p className="text-xs text-muted-foreground">
                Connecting to the server…
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
  const chat = useCallChat(conversationId, self.id)
  const canShare =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia)

  const selfTile: Tile = {
    key: SELF_ID,
    user: self,
    label: "You",
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

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {call.participants.map((p) => (
          <RemoteAudio key={p.id} stream={p.stream} />
        ))}

        <header className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-2">
          <h1 className="min-w-0 truncate text-sm font-medium">
            {call.title ?? "Call"}
          </h1>
          {call.phase === "reconnecting" ? (
            <Badge variant="secondary" className="gap-1">
              <WifiOffIcon className="size-3" aria-hidden />
              Reconnecting…
            </Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1" title="Participants">
              <UsersIcon className="size-3.5" aria-hidden />
              {tiles.length}
              <span className="sr-only"> participants</span>
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
                    ? "You are presenting"
                    : `${remotePresenter?.user.name} is presenting`}
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
              Waiting for others to join…
            </output>
          ) : null}
        </main>

        <footer className="flex shrink-0 items-center justify-center gap-3 px-4 pt-1 pb-4">
          <MicButton on={call.mic} onToggle={call.toggleMic} />
          <CameraButton on={call.camera} onToggle={call.toggleCamera} />
          {canShare ? (
            <ScreenButton on={call.screen} onToggle={call.toggleScreen} />
          ) : null}
          <DeviceMenu
            devices={call.devices}
            audioDeviceId={call.audioDeviceId}
            videoDeviceId={call.videoDeviceId}
            onSelect={call.selectDevice}
          />
          {conversationId ? (
            <ControlButton
              label={chat.open ? "Hide chat" : "Show chat"}
              aria-pressed={chat.open}
              className="relative"
              onClick={chat.toggle}
            >
              <MessageSquareIcon />
              {chat.unread ? (
                <span className="absolute top-1 right-1 size-2.5 rounded-full bg-red-500 ring-2 ring-background" />
              ) : null}
            </ControlButton>
          ) : null}
          <LeaveButton onLeave={leave} />
        </footer>
      </div>
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
  const isMobile = useIsMobile()
  const close = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Close chat"
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
          <SheetTitle className="sr-only">Chat</SheetTitle>
          <SheetDescription className="sr-only">
            Messages of this call's conversation
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
      aria-label="Chat"
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
    <time className="tabular-nums" title="Call duration">
      {h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`}
    </time>
  )
}

// --- ended -------------------------------------------------------------------------------------

function CallEnded({ reason }: { reason: string }) {
  const goBack = useGoBack()
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PhoneOffIcon />
          </EmptyMedia>
          <EmptyTitle>Call ended</EmptyTitle>
          <EmptyDescription>{reason}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={goBack}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
