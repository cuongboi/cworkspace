import { useQueryClient } from "@tanstack/react-query"
import { invalidateModels } from "@/lib/query"
import { useSocketEvent } from "./use-socket"

/**
 * Bridges server "something changed" events to the React Query cache. Queries keyed by model
 * name (`["post", …]`, see `@/lib/query`) refetch automatically; features only need custom
 * handlers for instant UX (e.g. appending chat messages). Mounted once by AppLayout.
 */
export function useRealtimeSync() {
  const qc = useQueryClient()

  useSocketEvent("post:changed", () => invalidateModels(qc, ["post", "group"]))
  useSocketEvent("comment:changed", () =>
    invalidateModels(qc, ["comment", "post"])
  )
  useSocketEvent("reaction:changed", () =>
    invalidateModels(qc, ["postReaction", "commentReaction", "post", "comment"])
  )
  useSocketEvent("poll:changed", () =>
    invalidateModels(qc, ["poll", "pollVote", "pollOption", "post"])
  )
  useSocketEvent("group:changed", () =>
    invalidateModels(qc, ["group", "groupMember"])
  )
  useSocketEvent("channel:changed", () => invalidateModels(qc, ["channel"]))
  useSocketEvent("wiki:changed", () =>
    invalidateModels(qc, ["wikiPage", "wikiRevision"])
  )

  // channel lists carry unread state
  useSocketEvent("message:new", () =>
    invalidateModels(qc, ["conversation", "conversationMember", "channel"])
  )
  useSocketEvent("message:changed", () =>
    invalidateModels(qc, ["message", "messageReaction"])
  )
  useSocketEvent("conversation:changed", () =>
    invalidateModels(qc, ["conversation", "conversationMember"])
  )
  useSocketEvent("conversation:read", () =>
    invalidateModels(qc, ["conversationMember", "channel"])
  )

  useSocketEvent("notification:new", () =>
    invalidateModels(qc, ["notification"])
  )
  useSocketEvent("event:changed", () =>
    invalidateModels(qc, ["event", "eventAttendee", "post"])
  )
}
