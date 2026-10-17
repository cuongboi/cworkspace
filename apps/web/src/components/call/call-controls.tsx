import { cn } from "cn"
import {
  MicIcon,
  MicOffIcon,
  MonitorOffIcon,
  MonitorUpIcon,
  PhoneOffIcon,
  Settings2Icon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { DeviceOption } from "@/lib/rtc/use-call"

/** Round icon button with a tooltip; `off` renders the "disabled device" (red) look. */
export function ControlButton({
  label,
  off = false,
  danger = false,
  children,
  className,
  ...props
}: ComponentProps<"button"> & {
  label: string
  off?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-lg"
          variant="secondary"
          aria-label={label}
          className={cn(
            "size-12 rounded-full [&_svg:not([class*='size-'])]:size-5",
            (off || danger) &&
              "bg-destructive text-white hover:bg-destructive/85",
            danger && "w-16",
            className
          )}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export function MicButton({
  on,
  onToggle,
  disabled,
}: {
  on: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <ControlButton
      label={on ? "Mute microphone" : "Unmute microphone"}
      aria-pressed={!on}
      off={!on}
      onClick={onToggle}
      disabled={disabled}
    >
      {on ? <MicIcon /> : <MicOffIcon />}
    </ControlButton>
  )
}

export function CameraButton({
  on,
  onToggle,
  disabled,
}: {
  on: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <ControlButton
      label={on ? "Turn camera off" : "Turn camera on"}
      aria-pressed={!on}
      off={!on}
      onClick={onToggle}
      disabled={disabled}
    >
      {on ? <VideoIcon /> : <VideoOffIcon />}
    </ControlButton>
  )
}

export function ScreenButton({
  on,
  onToggle,
}: {
  on: boolean
  onToggle: () => void
}) {
  return (
    <ControlButton
      label={on ? "Stop presenting" : "Share your screen"}
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        on && "bg-primary text-primary-foreground hover:bg-primary/85"
      )}
    >
      {on ? <MonitorOffIcon /> : <MonitorUpIcon />}
    </ControlButton>
  )
}

export function LeaveButton({ onLeave }: { onLeave: () => void }) {
  return (
    <ControlButton label="Leave call" danger onClick={onLeave}>
      <PhoneOffIcon />
    </ControlButton>
  )
}

export function DeviceMenu({
  devices,
  audioDeviceId,
  videoDeviceId,
  onSelect,
}: {
  devices: { audio: DeviceOption[]; video: DeviceOption[] }
  audioDeviceId: string | null
  videoDeviceId: string | null
  onSelect: (kind: "audio" | "video", deviceId: string) => void
}) {
  if (!devices.audio.length && !devices.video.length) return null
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-lg"
              variant="secondary"
              aria-label="Audio and video settings"
              className="size-12 rounded-full [&_svg:not([class*='size-'])]:size-5"
            >
              <Settings2Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Audio and video settings</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" className="w-72">
        {devices.audio.length ? (
          <>
            <DropdownMenuLabel>Microphone</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={audioDeviceId ?? ""}
              onValueChange={(id) => onSelect("audio", id)}
            >
              {devices.audio.map((d) => (
                <DropdownMenuRadioItem
                  key={d.deviceId}
                  value={d.deviceId}
                  className="truncate"
                >
                  {d.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        {devices.audio.length && devices.video.length ? (
          <DropdownMenuSeparator />
        ) : null}
        {devices.video.length ? (
          <>
            <DropdownMenuLabel>Camera</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={videoDeviceId ?? ""}
              onValueChange={(id) => onSelect("video", id)}
            >
              {devices.video.map((d) => (
                <DropdownMenuRadioItem
                  key={d.deviceId}
                  value={d.deviceId}
                  className="truncate"
                >
                  {d.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
