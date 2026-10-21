import { cn } from "cn"
import { useTranslation } from "react-i18next"
import {
  MediaPlayer,
  MediaPlayerControls,
  MediaPlayerControlsOverlay,
  MediaPlayerDownload,
  MediaPlayerError,
  MediaPlayerFullscreen,
  MediaPlayerLoading,
  MediaPlayerOverflow,
  MediaPlayerPiP,
  MediaPlayerPlay,
  MediaPlayerPlaybackSpeed,
  MediaPlayerSeek,
  MediaPlayerSeekBackward,
  MediaPlayerSeekForward,
  MediaPlayerTime,
  MediaPlayerVideo,
  MediaPlayerVolume,
  MediaPlayerVolumeIndicator,
} from "@/components/ui/media-player"
import { fileUrl } from "@/lib/upload"

/** Inline player for a `video/*` attachment. */
export function VideoAttachment({
  attachment,
  className,
}: {
  attachment: { id: string; mimeType: string }
  className?: string
}) {
  return (
    <VideoPlayer
      src={fileUrl(attachment.id)}
      mimeType={attachment.mimeType}
      className={className}
    />
  )
}

/** Inline video player for any URL (attachments, linked .mp4 files). */
export function VideoPlayer({
  src,
  mimeType,
  className,
}: {
  src: string
  mimeType?: string
  className?: string
}) {
  const { t } = useTranslation()
  return (
    // a container (not the viewport) decides: the same player sits in wide feeds and narrow chats
    <MediaPlayer
      className={cn("@container max-h-112 rounded-lg bg-black", className)}
    >
      <MediaPlayerVideo preload="metadata" playsInline>
        <source src={src} type={mimeType} />
      </MediaPlayerVideo>
      <MediaPlayerLoading />
      <MediaPlayerError />
      <MediaPlayerVolumeIndicator />
      <MediaPlayerControls className="flex-col items-start gap-2.5 px-2 @md:px-4">
        <MediaPlayerControlsOverlay />
        <MediaPlayerSeek />
        <div className="flex w-full items-center gap-1 @md:gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 @md:gap-2">
            <MediaPlayerPlay />
            <MediaPlayerSeekBackward className="hidden @md:inline-flex" />
            <MediaPlayerSeekForward className="hidden @md:inline-flex" />
            <MediaPlayerVolume expandable />
            {/* "-1:18" when there's no room for "0:12 / 1:30" */}
            <MediaPlayerTime
              variant="remaining"
              className="truncate @xs:hidden"
            />
            <MediaPlayerTime className="hidden truncate @xs:flex" />
          </div>
          <div className="flex shrink-0 items-center gap-1 @md:gap-2">
            <MediaPlayerPlaybackSpeed className="hidden @md:inline-flex" />
            <MediaPlayerPiP className="hidden @md:inline-flex" />
            <MediaPlayerDownload className="hidden @md:inline-flex" />
            <MediaPlayerOverflow
              className="@md:hidden"
              labels={{
                more: t("common.media.more"),
                back: t("common.media.back", { count: 10 }),
                forward: t("common.media.forward", { count: 10 }),
                speed: t("common.media.speed"),
                pip: t("common.media.pip"),
                download: t("common.media.download"),
              }}
            />
            <MediaPlayerFullscreen />
          </div>
        </div>
      </MediaPlayerControls>
    </MediaPlayer>
  )
}

/**
 * Linked audio file. Native controls: MediaPlayer's control sheet is a dark auto-hiding video
 * overlay, wrong for a light inline bar.
 */
export function AudioPlayer({
  src,
  mimeType,
  className,
}: {
  src: string
  mimeType?: string
  className?: string
}) {
  return (
    <audio controls preload="metadata" className={cn("w-full", className)}>
      <source src={src} type={mimeType} />
    </audio>
  )
}
