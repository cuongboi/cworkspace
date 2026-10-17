import { createContext, useContext } from "react"

/**
 * The element that scrolls the page area of `AppLayout` (the window itself never scrolls).
 * Virtualized lists inside regular pages use it as their scroll container.
 */
export const PageScrollContext = createContext<HTMLElement | null>(null)

export function usePageScrollElement() {
  return useContext(PageScrollContext)
}
