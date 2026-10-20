import { useQueryClient } from "@tanstack/react-query"
import { addHours } from "date-fns"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useApp } from "@/hooks/use-app"
import { ApiError, db } from "@/lib/api-client"
import { invalidateModels } from "@/lib/query"

export const FOREVER = new Date("9999-12-31T00:00:00.000Z")

export const MUTE_OPTIONS = [
  { value: "off", label: "chat.info.mute.off" },
  { value: "1", label: "chat.info.mute.h1" },
  { value: "8", label: "chat.info.mute.h8" },
  { value: "24", label: "chat.info.mute.h24" },
  { value: "forever", label: "chat.info.mute.forever" },
] as const

export type MuteValue = (typeof MUTE_OPTIONS)[number]["value"]

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback

/** My per-conversation actions (mute, favorite, copy link, leave), shared by the sidebar and the info panel. */
export function useConversationActions(
  conversationId: string,
  options?: { onLeft?: () => void }
) {
  const { t } = useTranslation()
  const { me } = useApp()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const where = { conversationId_userId: { conversationId, userId: me.id } }

  const refresh = () =>
    invalidateModels(qc, ["conversation", "conversationMember"])

  const setMute = async (value: MuteValue) => {
    const until =
      value === "off"
        ? null
        : value === "forever"
          ? FOREVER
          : addHours(new Date(), Number(value))
    try {
      await db.conversationMember.update({
        where,
        data: { mutedUntil: until },
        select: { id: true },
      })
      await refresh()
      toast.success(
        until ? t("chat.info.mutedToast") : t("chat.info.unmutedToast")
      )
    } catch (err) {
      toast.error(errorMessage(err, t("chat.info.muteFailed")))
    }
  }

  const setFavorite = async (favorite: boolean) => {
    try {
      await db.conversationMember.update({
        where,
        data: { favoritedAt: favorite ? new Date() : null },
        select: { id: true },
      })
      await refresh()
    } catch (err) {
      toast.error(errorMessage(err, t("chat.list.menu.favoriteFailed")))
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/chat/${conversationId}`
      )
      toast.success(t("chat.list.menu.linkCopied"))
    } catch {
      toast.error(t("chat.list.menu.copyFailed"))
    }
  }

  const leave = async () => {
    try {
      await db.conversationMember.delete({ where, select: { id: true } })
      options?.onLeft?.()
      // leaving from the sidebar shouldn't close another open chat
      if (window.location.pathname.startsWith(`/chat/${conversationId}`))
        await navigate("/chat")
      await refresh()
      toast.success(t("chat.info.left"))
    } catch (err) {
      toast.error(errorMessage(err, t("chat.info.leaveFailed")))
    }
  }

  return { refresh, setMute, setFavorite, copyLink, leave }
}
