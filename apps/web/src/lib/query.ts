import {
  type InfiniteData,
  QueryClient,
  type QueryKey,
  type UseQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ApiError, type Db } from "./api-client"

/**
 * React Query bindings for `db` from `@/lib/api-client`. Pass the `db` call itself so the exact
 * ZenStack result type (with `include`/`select`) is preserved:
 *
 *   const { data } = useDbQuery(["post", "findMany", args], () => db.post.findMany(args))
 *
 * Keys start with the model's delegate name so `invalidateModels` / socket events can target them.
 */

export type ModelName = keyof Db & string

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Policy/auth errors won't fix themselves.
        retry: (count, err) =>
          !(err instanceof ApiError && err.status >= 400 && err.status < 500) &&
          count < 2,
      },
    },
  })
}

export function useDbQuery<T>(
  key: readonly [ModelName, ...unknown[]],
  queryFn: () => Promise<T>,
  options?: Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn">
) {
  return useQuery<T, ApiError>({
    queryKey: key as QueryKey,
    queryFn,
    ...options,
  })
}

/**
 * Cursor pagination over rows with an `id`. `fetchPage(cursor)` must pass
 * `take: pageSize` and, when `cursor` is set, `cursor: { id: cursor }, skip: 1`.
 */
export function useDbInfinite<T extends { id: string }>(
  key: readonly [ModelName, ...unknown[]],
  fetchPage: (cursor: string | undefined) => Promise<T[]>,
  pageSize: number
) {
  return useInfiniteQuery<
    T[],
    ApiError,
    InfiniteData<T[], string | undefined>,
    QueryKey,
    string | undefined
  >({
    queryKey: key as QueryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined,
    getNextPageParam: (last) =>
      last.length === pageSize ? last[last.length - 1]?.id : undefined,
  })
}

/** A `db` mutation that refetches the given models' queries on success. */
export function useDbMutation<TVars, TResult>(
  mutationFn: (vars: TVars) => Promise<TResult>,
  { invalidates = [] }: { invalidates?: ModelName[] } = {}
) {
  const queryClient = useQueryClient()
  return useMutation<TResult, ApiError, TVars>({
    mutationFn,
    onSuccess: () => invalidateModels(queryClient, invalidates),
  })
}

export function invalidateModels(
  queryClient: QueryClient,
  models: ModelName[]
) {
  return Promise.all(
    models.map((model) => queryClient.invalidateQueries({ queryKey: [model] }))
  )
}
