import * as React from "react"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type WorkspaceDialogPlacement = "center" | "top-right"

type WorkspaceDialogContentProps = {
  open: boolean
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  headerActions?: React.ReactNode
  initialPlacement?: WorkspaceDialogPlacement
  draggable?: boolean
  viewportPadding?: number
  className?: string
  bodyClassName?: string
  overlayClassName?: string
  closeLabel?: string
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  startLeft: number
  startTop: number
  clientX: number
  clientY: number
}

const mobileQuery = "(max-width: 700px)"
const interactiveSelector = "button, a, input, select, textarea, [role='button'], [contenteditable='true'], [data-workspace-dialog-no-drag]"

function WorkspaceDialogContent({
  open,
  title,
  description,
  children,
  footer,
  headerActions,
  initialPlacement = "center",
  draggable = false,
  viewportPadding = 16,
  className,
  bodyClassName,
  overlayClassName,
  closeLabel = "关闭",
}: WorkspaceDialogContentProps) {
  const popupRef = React.useRef<HTMLDivElement>(null)
  const headerRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const moveFrameRef = React.useRef<number | null>(null)
  const mobileRef = React.useRef(false)

  const clampPosition = React.useCallback((left: number, top: number) => {
    const popup = popupRef.current
    if (!popup) return { left, top }
    const rect = popup.getBoundingClientRect()
    return {
      left: Math.min(Math.max(viewportPadding, left), Math.max(viewportPadding, window.innerWidth - viewportPadding - rect.width)),
      top: Math.min(Math.max(viewportPadding, top), Math.max(viewportPadding, window.innerHeight - viewportPadding - rect.height)),
    }
  }, [viewportPadding])

  const writePosition = React.useCallback((left: number, top: number) => {
    const popup = popupRef.current
    if (!popup) return
    const next = clampPosition(left, top)
    popup.style.left = `${next.left}px`
    popup.style.top = `${next.top}px`
    popup.style.right = "auto"
    popup.style.bottom = "auto"
    popup.style.translate = "none"
  }, [clampPosition])

  const clearPosition = React.useCallback(() => {
    const popup = popupRef.current
    if (!popup) return
    popup.style.removeProperty("left")
    popup.style.removeProperty("top")
    popup.style.removeProperty("right")
    popup.style.removeProperty("bottom")
    popup.style.removeProperty("translate")
  }, [])

  const restoreInitialPosition = React.useCallback(() => {
    const popup = popupRef.current
    if (!popup || window.matchMedia(mobileQuery).matches) {
      clearPosition()
      return
    }
    const rect = popup.getBoundingClientRect()
    const left = initialPlacement === "top-right"
      ? window.innerWidth - viewportPadding - rect.width
      : (window.innerWidth - rect.width) / 2
    const top = initialPlacement === "top-right"
      ? viewportPadding
      : (window.innerHeight - rect.height) / 2
    writePosition(left, top)
  }, [clearPosition, initialPlacement, viewportPadding, writePosition])

  const flushMove = React.useCallback(() => {
    if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current)
    moveFrameRef.current = null
    const drag = dragRef.current
    if (!drag) return
    writePosition(
      drag.startLeft + drag.clientX - drag.startX,
      drag.startTop + drag.clientY - drag.startY,
    )
  }, [writePosition])

  const cancelMoveFrame = React.useCallback(() => {
    if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current)
    moveFrameRef.current = null
  }, [])

  const finishDrag = React.useCallback(() => {
    const drag = dragRef.current
    if (!drag) {
      cancelMoveFrame()
      return
    }
    flushMove()
    dragRef.current = null
    const header = headerRef.current
    if (header?.hasPointerCapture(drag.pointerId)) header.releasePointerCapture(drag.pointerId)
  }, [cancelMoveFrame, flushMove])

  React.useLayoutEffect(() => {
    if (open) {
      mobileRef.current = window.matchMedia(mobileQuery).matches
      restoreInitialPosition()
    } else {
      finishDrag()
      clearPosition()
    }
  }, [clearPosition, finishDrag, open, restoreInitialPosition])

  React.useLayoutEffect(() => {
    if (!open) return
    const mountedHeader = headerRef.current
    mobileRef.current = window.matchMedia(mobileQuery).matches

    function handleResize() {
      const mobile = window.matchMedia(mobileQuery).matches
      if (mobile) {
        finishDrag()
        clearPosition()
      } else if (mobileRef.current) {
        restoreInitialPosition()
      } else {
        const rect = popupRef.current?.getBoundingClientRect()
        if (rect) writePosition(rect.left, rect.top)
      }
      mobileRef.current = mobile
    }

    window.addEventListener("resize", handleResize)
    window.addEventListener("blur", finishDrag)
    return () => {
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("blur", finishDrag)
      cancelMoveFrame()
      const drag = dragRef.current
      if (drag && mountedHeader?.hasPointerCapture(drag.pointerId)) mountedHeader.releasePointerCapture(drag.pointerId)
      dragRef.current = null
    }
  }, [cancelMoveFrame, clearPosition, finishDrag, open, restoreInitialPosition, writePosition])

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggable || event.button !== 0 || window.matchMedia(mobileQuery).matches) return
    const interactive = (event.target as HTMLElement).closest(interactiveSelector)
    if (interactive && interactive !== event.currentTarget) return
    const rect = popupRef.current?.getBoundingClientRect()
    if (!rect) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      clientX: event.clientX,
      clientY: event.clientY,
    }
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.clientX = event.clientX
    drag.clientY = event.clientY
    if (moveFrameRef.current !== null) return
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null
      flushMove()
    })
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    finishDrag()
  }

  return (
    <DialogContent
      ref={popupRef}
      className={cn(
        "flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0",
        initialPlacement === "top-right" && "top-4 right-4 bottom-auto left-auto [translate:none]",
        "max-[700px]:inset-0 max-[700px]:h-[100svh] max-[700px]:w-screen max-[700px]:max-h-none max-[700px]:max-w-none max-[700px]:rounded-none max-[700px]:[translate:none]",
        className,
      )}
      overlayClassName={overlayClassName}
      showCloseButton={false}
    >
      <div
        ref={headerRef}
        data-slot="workspace-dialog-header"
        className={cn(
          "flex min-h-18 shrink-0 items-center gap-3 border-b px-4 py-3",
          draggable && "cursor-grab touch-none select-none active:cursor-grabbing max-[700px]:cursor-default max-[700px]:touch-auto max-[700px]:select-text",
        )}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={stopDrag}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </div>
        {headerActions ? <div data-workspace-dialog-no-drag className="flex shrink-0 items-center gap-1">{headerActions}</div> : null}
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" aria-label={closeLabel} />}
        >
          <XIcon />
          <span className="sr-only">{closeLabel}</span>
        </DialogClose>
      </div>
      <div
        data-slot="workspace-dialog-body"
        className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName)}
      >
        {children}
      </div>
      {footer ? (
        <div data-slot="workspace-dialog-footer" className="shrink-0 border-t bg-muted/50 p-4">
          {footer}
        </div>
      ) : null}
    </DialogContent>
  )
}

export { WorkspaceDialogContent }
export type { WorkspaceDialogContentProps, WorkspaceDialogPlacement }
