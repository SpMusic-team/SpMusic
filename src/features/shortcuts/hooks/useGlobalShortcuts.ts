import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { isShortcutAction, shortcutErrorMessage } from '../model/globalShortcuts'
import { isShortcutCaptureSuspended } from '../services/globalShortcutCommands'

type ShortcutPlayer = {
  track: unknown
  volume: number
  volumeDisabled: boolean
  previous: () => void
  next: () => void
  togglePlayback: () => void
  changeVolume: (volume: number) => void
}

export function useGlobalShortcuts(player: ShortcutPlayer) {
  const volumeRef = useRef(player.volume)
  useLayoutEffect(() => { volumeRef.current = player.volume }, [player.volume])
  const handleAction = useEffectEvent((action: unknown) => {
    if (!isShortcutAction(action) || isShortcutCaptureSuspended()) return
    if (action === 'previous') player.previous()
    else if (action === 'next') player.next()
    else if (action === 'togglePlayback') { if (player.track) player.togglePlayback() }
    else if (!player.volumeDisabled) {
      volumeRef.current = Math.max(0, Math.min(100, volumeRef.current + (action === 'volumeUp' ? 5 : -5)))
      player.changeVolume(volumeRef.current)
    }
  })

  useEffect(() => {
    if (!isTauri()) return
    let active = true
    let unlisten: (() => void) | undefined
    void listen<{ action: unknown }>('spmusic://global-shortcut-action', (event) => {
      if (active) handleAction(event.payload?.action)
    }).then((cleanup) => {
      if (active) unlisten = cleanup
      else cleanup()
    }).catch((error: unknown) => {
      if (active) toast.error(`全局快捷键监听失败：${shortcutErrorMessage(error)}`)
    })
    return () => { active = false; unlisten?.() }
  }, [])
}
