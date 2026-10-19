import { useEffect, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { useSocket, useSocketEvent } from "@/hooks/use-socket"
import { api } from "@/lib/api-client"
import type { CallKind } from "@/lib/realtime-events"
import {
  CallSession,
  type CallState,
  DEFAULT_ICE_SERVERS,
} from "./call-session"

export type {
  CallPhase,
  CaptionLine,
  CaptionPart,
  CallState,
  DeviceOption,
  RemoteParticipant,
} from "./call-session"
export { SELF_ID } from "./call-session"
export type { CaptionStatus } from "./caption-stream"

async function fetchIceServers() {
  const { iceServers } = await api.get<{
    iceServers: RTCIceServer[]
    ttl: number
  }>("/api/rtc/ice")
  return iceServers.length ? iceServers : DEFAULT_ICE_SERVERS
}

/**
 * One call screen: local media, the transport (mesh today), participants and active speaker.
 * `kind` (the call's AUDIO/VIDEO type) starts the lobby preview once known. Leaves the call on
 * unmount and on `pagehide` (tab closed / navigated away).
 */
export function useCall(callId: string, kind: CallKind | null) {
  const socket = useSocket()
  const [session] = useState(
    () =>
      new CallSession({
        callId,
        getIceServers: fetchIceServers,
        onNotice: (message, level) =>
          level === "error" ? toast.error(message) : toast(message),
      })
  )
  const state: CallState = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot
  )

  useEffect(() => {
    if (!kind) return
    session.activate(kind)
    return () => session.deactivate()
  }, [session, kind])

  useEffect(() => {
    const onPageHide = () => session.leave()
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [session])

  // the call can end while we're still in the lobby (ring timeout, caller hung up)
  useSocketEvent("call:ended", (p) => {
    if (p.callId === callId) session.markEnded()
  })
  useSocketEvent("call:caption", (p) => session.receiveCaption(p))
  useSocketEvent("call:caption-mark", (p) => session.receiveMark(p))
  useSocketEvent("call:glossary", (p) => session.receiveGlossary(p))

  return {
    ...state,
    connected: Boolean(socket),
    join: () => {
      if (socket) void session.join(socket)
    },
    leave: () => session.leave(),
    toggleMic: () => void session.toggleMic(),
    toggleCamera: () => void session.toggleCamera(),
    toggleScreen: () => void session.toggleScreen(),
    setCaptions: session.setCaptions,
    setGlossary: session.setGlossary,
    selectDevice: (k: "audio" | "video", deviceId: string) =>
      void session.selectDevice(k, deviceId),
  }
}

export type UseCall = ReturnType<typeof useCall>
