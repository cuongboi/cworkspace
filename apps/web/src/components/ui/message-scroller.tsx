import * as React from "react"
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from "@shadcn/react/message-scroller"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { ArrowDownIcon } from "lucide-react"

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

// The primitive's Viewport must be the real scrolling element (it reads
// scrollTop and anchors on it), so Radix ScrollArea can't wrap it. Instead the
// native scrollbar is hidden and a thumb styled like ScrollArea's is drawn.
const ViewportContext = React.createContext<
  React.Dispatch<React.SetStateAction<HTMLDivElement | null>>
>(() => { })

function MessageScroller({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null)
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className
      )}
      {...props}
    >
      <ViewportContext.Provider value={setViewport}>
        {children}
      </ViewportContext.Provider>
      <MessageScrollerScrollbar viewport={viewport} />
    </MessageScrollerPrimitive.Root>
  )
}

function MessageScrollerScrollbar({
  viewport,
}: {
  viewport: HTMLDivElement | null
}) {
  const trackRef = React.useRef<HTMLDivElement>(null)
  const thumbRef = React.useRef<HTMLDivElement>(null)
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!viewport || !track || !thumb) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = viewport
        const overflow = scrollHeight - clientHeight
        setVisible(overflow > 1)
        if (overflow <= 1) return
        const trackHeight = track.clientHeight
        const height = Math.max((clientHeight / scrollHeight) * trackHeight, 18)
        thumb.style.height = `${height}px`
        thumb.style.transform = `translateY(${(scrollTop / overflow) * (trackHeight - height)
          }px)`
      })
    }
    update()
    viewport.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    for (const child of Array.from(viewport.children)) observer.observe(child)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [viewport])

  function onThumbPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!viewport || !trackRef.current || !thumbRef.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startTop = viewport.scrollTop
    const ratio =
      (viewport.scrollHeight - viewport.clientHeight) /
      (trackRef.current.clientHeight - thumbRef.current.offsetHeight)
    const target = e.currentTarget
    const move = (ev: PointerEvent) => {
      viewport.scrollTo({ top: startTop + (ev.clientY - startY) * ratio })
    }
    const up = () => {
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", up)
      target.removeEventListener("pointercancel", up)
    }
    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", up)
    target.addEventListener("pointercancel", up)
  }

  function onTrackPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!viewport || e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = (e.clientY - rect.top) / rect.height
    viewport.scrollTo({
      top: fraction * viewport.scrollHeight - viewport.clientHeight / 2,
    })
  }

  return (
    <div
      ref={trackRef}
      data-slot="scroll-area-scrollbar"
      aria-hidden
      hidden={!visible}
      onPointerDown={onTrackPointerDown}
      className="absolute inset-y-0 right-0 z-10 flex w-2.5 touch-none border-l border-l-transparent p-px select-none group-has-data-autoscrolling/message-scroller:opacity-0 group-has-data-pending-scroll/message-scroller:invisible"
    >
      <div
        ref={thumbRef}
        data-slot="scroll-area-thumb"
        onPointerDown={onThumbPointerDown}
        className="relative w-full rounded-full bg-border"
      />
    </div>
  )
}

function MessageScrollerViewport({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  const setViewport = React.useContext(ViewportContext)
  const mergedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setViewport(node)
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [ref, setViewport]
  )
  return (
    <MessageScrollerPrimitive.Viewport
      ref={mergedRef}
      data-slot="message-scroller-viewport"
      className={cn(
        "size-full min-h-0 min-w-0 scroll-fade-b scrollbar-none overflow-y-auto overscroll-contain contain-content data-pending-scroll:invisible [&::-webkit-scrollbar]:hidden",
        className
      )}
      {...props}
    />
  )
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn("flex h-max min-h-full flex-col gap-8", className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn(
        "min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]",
        className
      )}
      {...props}
    />
  )
}

function MessageScrollerButton({
  direction = "end",
  className,
  children,
  render,
  variant = "secondary",
  size = "icon-sm",
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      className={cn(
        "absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180",
        className
      )}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDownIcon />
          <span className="sr-only">
            {direction === "end" ? "Scroll to end" : "Scroll to start"}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
