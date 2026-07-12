import { getCurrentWindow } from '@tauri-apps/api/window'
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
        <IconButton icon={systemIcons.maximize} label={appCopy.controls.maximize} onClick={() => runWindowAction((windowRef) => windowRef.toggleMaximize())} />
        <IconButton icon={systemIcons.close} label={appCopy.controls.close} onClick={() => runWindowAction((windowRef) => windowRef.close())} />
      </div>
    </header>
  )
}
