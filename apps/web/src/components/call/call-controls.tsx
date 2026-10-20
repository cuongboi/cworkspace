import { cn } from "cn"
import {
  CaptionsIcon,
  CaptionsOffIcon,
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  CAPTION_LANGUAGES,
  type CaptionPrefs,
  isCaptionLang,
} from "@/lib/realtime-events"
import type { CaptionStatus, DeviceOption } from "@/lib/rtc/use-call"
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()
  return (
    <ControlButton
      label={on ? t("call.controls.mute") : t("call.controls.unmute")}
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
  const { t } = useTranslation()
  return (
    <ControlButton
      label={on ? t("call.controls.cameraOff") : t("call.controls.cameraOn")}
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
  const { t } = useTranslation()
  return (
    <ControlButton
      label={
        on ? t("call.controls.stopPresenting") : t("call.controls.shareScreen")
      }
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
  const { t } = useTranslation()
  return (
    <ControlButton label={t("call.controls.leave")} danger onClick={onLeave}>
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
  const { t } = useTranslation()
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
              aria-label={t("call.controls.deviceSettings")}
              className="size-12 rounded-full [&_svg:not([class*='size-'])]:size-5"
            >
              <Settings2Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t("call.controls.deviceSettings")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" className="w-72">
        {devices.audio.length ? (
          <>
            <DropdownMenuLabel>
              {t("call.controls.microphone")}
            </DropdownMenuLabel>
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
            <DropdownMenuLabel>{t("call.controls.camera")}</DropdownMenuLabel>
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

/** CC: live captions on/off + the language the user speaks and reads them in. */

export function CaptionsButton({
  captions,
  available,
  status,
  error,
  onChange,
  onEditGlossary,
}: {
  captions: CaptionPrefs
  available: boolean
  status: CaptionStatus
  error: string | null
  onChange: (captions: CaptionPrefs) => void
  /** in the call only: the glossary is shared by the people in it */
  onEditGlossary?: () => void
}) {
  const { t } = useTranslation()
  const label = !available
    ? t("call.captions.unavailable")
    : captions.enabled
      ? t("call.captions.settings")
      : t("call.captions.turnOn")
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={!available}>
            <Button
              type="button"
              size="icon-lg"
              variant="secondary"
              aria-label={label}
              aria-pressed={captions.enabled}
              className={cn(
                "size-12 rounded-full [&_svg:not([class*='size-'])]:size-5",
                captions.enabled &&
                  available &&
                  "bg-primary text-primary-foreground hover:bg-primary/85"
              )}
            >
              {captions.enabled && available ? (
                <CaptionsIcon />
              ) : (
                <CaptionsOffIcon />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" className="w-64">
        <DropdownMenuCheckboxItem
          checked={captions.enabled}
          onCheckedChange={(enabled) => onChange({ ...captions, enabled })}
        >
          {t("call.captions.show")}
        </DropdownMenuCheckboxItem>
        <p
          className={cn(
            "px-2 pb-1.5 text-xs text-muted-foreground",
            status === "error" && "text-destructive"
          )}
        >
          {t(`call.captions.status.${status}`)}
          {status === "error" && error ? `: ${error}` : null}
        </p>
        {onEditGlossary ? (
          <DropdownMenuItem onSelect={onEditGlossary}>
            {t("call.captions.glossary")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("call.captions.language")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={captions.lang}
          onValueChange={(lang) => {
            if (isCaptionLang(lang)) onChange({ enabled: true, lang })
          }}
        >
          {Object.entries(CAPTION_LANGUAGES).map(([code, name]) => (
            <DropdownMenuRadioItem key={code} value={code}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
