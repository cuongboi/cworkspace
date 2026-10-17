import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSocket, useSocketEvent } from "@/hooks/use-socket"
import type { GroupCallState } from "@/lib/realtime-events"

export const groupCallKey = (groupId: string) => ["groupCall", groupId] as const

/**
 * The group's live drop-in call. Call state lives in the API process (not the database), so it is
 * read over the socket once and then pushed on every change (`group:call` to the group room). The
 * key isn't a model name: a socket reconnect refetches it like every other mounted query.
 */
export function useGroupCall(groupId: string, enabled: boolean) {
  const socket = useSocket()
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: groupCallKey(groupId),
    queryFn: async (): Promise<GroupCallState> => {
      const res = await socket!
        .timeout(10_000)
        .emitWithAck("group:call:get", { groupId })
      if (!res.ok) throw new Error(res.error)
      return res.data
    },
    enabled: enabled && Boolean(socket),
    staleTime: Infinity,
  })

  useSocketEvent("group:call", (state) => {
    if (state.groupId === groupId) qc.setQueryData(groupCallKey(groupId), state)
  })

  return query.data?.call ? query.data : null
}
