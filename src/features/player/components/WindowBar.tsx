import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import { IconButton } from './IconButton'

export function WindowBar() {
  const systemIcons = useSystemIcons()

  return (
    <header className="window-bar">
      <IconButton icon={systemIcons.collapse} label={appCopy.controls.collapse} />
      <h1 id="app-title" className="sr-only">{appCopy.appTitle}</h1>
      <div className="window-actions">
        <IconButton icon={systemIcons.fullscreen} label={appCopy.controls.fullscreen} />
        <IconButton icon={systemIcons.minimize} label={appCopy.controls.minimize} />
        <IconButton icon={systemIcons.maximize} label={appCopy.controls.maximize} />
        <IconButton icon={systemIcons.close} label={appCopy.controls.close} />
      </div>
    </header>
  )
}
