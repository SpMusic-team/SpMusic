import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import { IconButton } from './IconButton'

type TauriWindow = ReturnType<typeof getCurrentWindow>

function getTauriWindow(): TauriWindow | null {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null
  return getCurrentWindow()
}

export function WindowBar() {
  const systemIcons = useSystemIcons()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const appWindow = getTauriWindow()
    let active = true
    let unlistenResize: (() => void) | undefined
    let unlistenFocus: (() => void) | undefined

    if (!appWindow) return undefined

    const windowRef = appWindow

    async function syncMaximizedState() {
      try {
        const isMaximized = await windowRef.isMaximized()
        if (active) setMaximized(isMaximized)
      } catch (error: unknown) {
        console.error('Window state sync failed', error)
      }
    }

    void syncMaximizedState()
    void windowRef.onResized(() => {
      void syncMaximizedState()
    }).then((unlisten) => {
      unlistenResize = unlisten
    }).catch((error: unknown) => {
      console.error('Window resize listener failed', error)
    })
    void windowRef.onFocusChanged(() => {
      void syncMaximizedState()
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
  }, [])

  function runWindowAction(action: (appWindow: TauriWindow) => Promise<void>) {
    const appWindow = getTauriWindow()

    if (!appWindow) return

    void action(appWindow).catch((error: unknown) => {
      console.error('Window action failed', error)
    })
  }

  return (
    <header className="window-bar" data-tauri-drag-region>
      <IconButton icon={systemIcons.collapse} label={appCopy.controls.collapse} />
      <h1 id="app-title" className="sr-only">{appCopy.appTitle}</h1>
      <div className="window-actions">
        <IconButton
          icon={systemIcons.fullscreen}
          label={appCopy.controls.fullscreen}
          onClick={() => runWindowAction(async (windowRef) => {
            await windowRef.setFullscreen(!(await windowRef.isFullscreen()))
          })}
        />
        <IconButton icon={systemIcons.minimize} label={appCopy.controls.minimize} onClick={() => runWindowAction((windowRef) => windowRef.minimize())} />
        <IconButton
          icon={maximized ? systemIcons.restore : systemIcons.maximize}
          label={maximized ? appCopy.controls.restore : appCopy.controls.maximize}
          onClick={() => runWindowAction(async (windowRef) => {
            await windowRef.toggleMaximize()
            setMaximized(await windowRef.isMaximized())
          })}
        />
        <IconButton icon={systemIcons.close} label={appCopy.controls.close} onClick={() => runWindowAction((windowRef) => windowRef.close())} />
      </div>
    </header>
  )
}
