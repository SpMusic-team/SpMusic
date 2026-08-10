import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState, type PointerEvent } from 'react'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import { IconButton } from './IconButton'
import { SettingsDialog } from './SettingsDialog'

type TauriWindow = ReturnType<typeof getCurrentWindow>

export type WindowLayoutState = {
  maximized: boolean
  fullscreen: boolean
}

type WindowBarProps = {
  onWindowStateChange: (state: WindowLayoutState) => void
  debugToolsEnabled?: boolean
  debugToolsOpen?: boolean
  onDebugToolsOpenChange?: (open: boolean) => void
}

function getTauriWindow(): TauriWindow | null {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null
  return getCurrentWindow()
}

export function WindowBar({
  onWindowStateChange,
  debugToolsEnabled = false,
  debugToolsOpen = false,
  onDebugToolsOpenChange,
}: WindowBarProps) {
  const systemIcons = useSystemIcons()
  const [maximized, setMaximized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const appWindow = getTauriWindow()
    let active = true
    let unlistenResize: (() => void) | undefined
    let unlistenFocus: (() => void) | undefined

    if (!appWindow) return undefined

    const windowRef = appWindow

    async function syncWindowState() {
      try {
        const [isMaximized, isFullscreen] = await Promise.all([
          windowRef.isMaximized(),
          windowRef.isFullscreen(),
        ])

        if (!active) return
        setMaximized(isMaximized)
        setFullscreen(isFullscreen)
        onWindowStateChange({ maximized: isMaximized, fullscreen: isFullscreen })
      } catch (error: unknown) {
        console.error('Window state sync failed', error)
      }
    }

    void syncWindowState()
    void windowRef.onResized(() => {
      void syncWindowState()
    }).then((unlisten) => {
      unlistenResize = unlisten
    }).catch((error: unknown) => {
      console.error('Window resize listener failed', error)
    })
    void windowRef.onFocusChanged(() => {
      void syncWindowState()
    }).then((unlisten) => {
      unlistenFocus = unlisten
    }).catch((error: unknown) => {
      console.error('Window focus listener failed', error)
    })

    return () => {
      active = false
      unlistenResize?.()
      unlistenFocus?.()
    }
  }, [onWindowStateChange])

  function runWindowAction(action: (appWindow: TauriWindow) => Promise<void>) {
    const appWindow = getTauriWindow()

    if (!appWindow) return

    void action(appWindow).catch((error: unknown) => {
      console.error('Window action failed', error)
    })
  }

  function startWindowDrag(event: PointerEvent<HTMLElement>) {
    if (fullscreen) return
    if (event.button !== 0 || event.isPrimary === false) return
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return

    const appWindow = getTauriWindow()
    if (!appWindow) return

    event.preventDefault()
    void appWindow.startDragging().catch((error: unknown) => {
      console.error('Window drag failed', error)
    })
  }

  function toggleMaximize() {
    runWindowAction(async (windowRef) => {
      await windowRef.toggleMaximize()
      const [isMaximized, isFullscreen] = await Promise.all([
        windowRef.isMaximized(),
        windowRef.isFullscreen(),
      ])
      setMaximized(isMaximized)
      setFullscreen(isFullscreen)
      onWindowStateChange({ maximized: isMaximized, fullscreen: isFullscreen })
    })
  }

  return (
    <header className="window-bar" data-fullscreen={fullscreen} data-tauri-drag-region={!fullscreen || undefined} onDoubleClick={fullscreen ? undefined : toggleMaximize} onPointerDown={startWindowDrag}>
      <div className="window-leading" onDoubleClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        <IconButton icon={systemIcons.collapse} label={appCopy.controls.collapse} />
      </div>
      <h1 id="app-title" className="sr-only">{appCopy.appTitle}</h1>
      <div className="window-actions" onDoubleClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        <SettingsDialog
          debugToolsEnabled={debugToolsEnabled}
          debugToolsOpen={debugToolsOpen}
          onDebugToolsOpenChange={onDebugToolsOpenChange}
        />
        <IconButton
          icon={systemIcons.fullscreen}
          label={appCopy.controls.fullscreen}
          onClick={() => runWindowAction(async (windowRef) => {
            const nextFullscreen = !(await windowRef.isFullscreen())
            await windowRef.setFullscreen(nextFullscreen)
            const isMaximized = await windowRef.isMaximized()
            setFullscreen(nextFullscreen)
            setMaximized(isMaximized)
            onWindowStateChange({ maximized: isMaximized, fullscreen: nextFullscreen })
          })}
        />
        <IconButton icon={systemIcons.minimize} label={appCopy.controls.minimize} onClick={() => runWindowAction((windowRef) => windowRef.minimize())} />
        <IconButton
          icon={maximized ? systemIcons.restore : systemIcons.maximize}
          label={maximized ? appCopy.controls.restore : appCopy.controls.maximize}
          onClick={toggleMaximize}
        />
        <IconButton icon={systemIcons.close} label={appCopy.controls.close} onClick={() => runWindowAction((windowRef) => windowRef.close())} />
      </div>
    </header>
  )
}
