import { cn } from "cn"
import { useEffect, useRef } from "react"

/** Retries `play()` once the user interacts with the page (autoplay policies). */
function playWhenAllowed(el: HTMLMediaElement) {
  el.play().catch((err: unknown) => {
    if (!(err instanceof DOMException) || err.name !== "NotAllowedError") return
    const retry = () => {
      el.play().catch(() => undefined)
    }
    document.addEventListener("pointerdown", retry, { once: true })
    document.addEventListener("keydown", retry, { once: true })
  })
}

/**
 * Binds a MediaStream to a muted <video> (audio is played separately by `RemoteAudio`, so
 * autoplay of video is always allowed). Re-plays when a remote track unmutes (Safari pauses).
 */
export function StreamVideo({
  stream,
  mirrored = false,
  fit = "cover",
  className,
}: {
  stream: MediaStream | null
  mirrored?: boolean
  fit?: "cover" | "contain"
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    if (!stream) return
    playWhenAllowed(el)
    const onUnmute = () => {
      if (el.paused) el.play().catch(() => undefined)
    }
    const tracks = stream.getVideoTracks()
    for (const track of tracks) track.addEventListener("unmute", onUnmute)
    return () => {
      for (const track of tracks) track.removeEventListener("unmute", onUnmute)
    }
  }, [stream])

  useEffect(() => {
    const el = ref.current
    return () => {
      if (el) el.srcObject = null
    }
  }, [])

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        "size-full bg-black",
        fit === "cover" ? "object-cover" : "object-contain",
        mirrored && "-scale-x-100",
        className
      )}
    />
  )
}

/** Plays a remote participant's audio (hidden). */
export function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const audio = stream?.getAudioTracks() ?? []
    const next = audio.length ? new MediaStream(audio) : null
    el.srcObject = next
    if (next) playWhenAllowed(el)
  }, [stream])

  useEffect(() => {
    const el = ref.current
    return () => {
      if (el) el.srcObject = null
    }
  }, [])

  // biome-ignore lint/a11y/useMediaCaption: live call audio has no captions track
  return <audio ref={ref} autoPlay className="hidden" />
}
