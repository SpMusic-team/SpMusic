import { invoke, isTauri } from '@tauri-apps/api/core'
import { parseGlobalShortcutSettings, type ShortcutBindings } from '../model/globalShortcuts'

let suspensionQueue: Promise<unknown> = Promise.resolve()
let captureSuspended = false
let requestedSuspension = false

export function isShortcutCaptureSuspended() { return captureSuspended }

async function settingsCommand(command: string, args?: Record<string, unknown>) {
  if (!isTauri()) throw new Error('全局快捷键仅在桌面应用中可用。')
  const settings = parseGlobalShortcutSettings(await invoke(command, args))
  captureSuspended = requestedSuspension || settings.suspended
  return settings
}

export function getGlobalShortcutSettings() {
  return settingsCommand('global_shortcuts_get_settings')
}

export function updateGlobalShortcutSettings(bindings: ShortcutBindings) {
  return settingsCommand('global_shortcuts_update_settings', { input: { bindings } })
}

// Serializing native suspension also orders a cleanup after a pending capture start.
export function setGlobalShortcutsSuspended(suspended: boolean) {
  requestedSuspension = suspended
  if (suspended) captureSuspended = true
  const operation = suspensionQueue.then(async () => {
    const settings = await settingsCommand('global_shortcuts_set_suspended', { suspended })
    return settings
  })
  suspensionQueue = operation.catch(() => undefined)
  return operation
}
