import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
} from "react"

export type ThreadScrollHandle = {
  scrollToEnd: (options?: { behavior?: "auto" | "smooth" }) => void
  /** scrolls to a message, loading older pages until it is found */
  jumpTo: (messageId: string) => void
}

const ThreadScrollContext =
  createContext<RefObject<ThreadScrollHandle | null> | null>(null)

/**
 * Lets siblings of the message list (the composer, message search) drive its scroll position. The list owns the
 * virtualizer and registers itself here with `useRegisterThreadScroll`.
 */
export function ThreadScrollProvider({ children }: { children: ReactNode }) {
  const handle = useRef<ThreadScrollHandle | null>(null)
  return <ThreadScrollContext value={handle}>{children}</ThreadScrollContext>
}

export function useThreadScroll(): ThreadScrollHandle {
  const handle = useContext(ThreadScrollContext)
  return {
    scrollToEnd: (options) => handle?.current?.scrollToEnd(options),
    jumpTo: (messageId) => handle?.current?.jumpTo(messageId),
  }
}

export function useRegisterThreadScroll(target: ThreadScrollHandle) {
  const handle = useContext(ThreadScrollContext)
  useEffect(() => {
    if (!handle) return
    handle.current = target
    return () => {
      if (handle.current === target) handle.current = null
    }
  }, [handle, target])
}
