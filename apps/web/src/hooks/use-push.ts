import { useEffect } from "react"
import { refreshPush } from "@/lib/push"

/** Keeps this device's push token current. Never prompts: enabling happens in the profile. */
export function usePushRefresh() {
  useEffect(() => {
    refreshPush().catch((err) => console.warn("[push] refresh", err))
  }, [])
}
