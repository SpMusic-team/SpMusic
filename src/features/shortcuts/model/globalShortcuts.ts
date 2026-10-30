export const shortcutActions = ['previous', 'next', 'volumeUp', 'volumeDown', 'togglePlayback'] as const
export type ShortcutAction = typeof shortcutActions[number]
export type ShortcutBindings = Record<ShortcutAction, string | null>
export type ShortcutIssue = { action: ShortcutAction | null; message: string }
export type GlobalShortcutSettings = { bindings: ShortcutBindings; issues: ShortcutIssue[]; suspended: boolean }

export const shortcutLabels: Record<ShortcutAction, string> = {
  previous: '上一首', next: '下一首', volumeUp: '提高音量', volumeDown: '降低音量', togglePlayback: '播放 / 暂停',
}
export const defaultShortcutBindings: ShortcutBindings = {
  previous: 'Ctrl+Alt+ArrowLeft', next: 'Ctrl+Alt+ArrowRight', volumeUp: 'Ctrl+Alt+ArrowUp', volumeDown: 'Ctrl+Alt+ArrowDown', togglePlayback: 'Ctrl+KeyP',
}

const specialKeys: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: '空格',
}
export function formatShortcut(binding: string | null): string {
  return binding === null ? '未设置' : binding.split('+').map((part) => specialKeys[part] ?? part.replace(/^(Key|Digit)/, '')).join(' + ')
}

export function isShortcutAction(value: unknown): value is ShortcutAction {
  return typeof value === 'string' && shortcutActions.some((action) => action === value)
}

export function isSupportedShortcutCode(code: string): boolean {
  return /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4])|Arrow(Left|Right|Up|Down)|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote)$/.test(code)
}

export type ShortcutKeyEvent = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing' | 'repeat'>
export function shortcutFromKeyEvent(event: ShortcutKeyEvent): string | null {
  if (event.isComposing || event.repeat || !isSupportedShortcutCode(event.code)) return null
  const modifiers = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean)
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null
  return [...modifiers, event.code].join('+')
}

export function validateShortcutBindings(bindings: ShortcutBindings): ShortcutIssue[] {
  const issues: ShortcutIssue[] = []
  const seen = new Map<string, ShortcutAction>()
  for (const action of shortcutActions) {
    const binding = bindings[action]
    if (binding === null) continue
    const parts = binding.split('+')
    const code = parts.pop() ?? ''
    const order = ['Ctrl', 'Alt', 'Shift', 'Super'].filter((modifier) => parts.includes(modifier))
    if (!parts.some((part) => ['Ctrl', 'Alt', 'Super'].includes(part)) || parts.join('+') !== order.join('+') || !isSupportedShortcutCode(code)) {
      issues.push({ action, message: '请录制包含 Ctrl、Alt 或 Super 的有效组合，可搭配 Shift。' })
      continue
    }
    const previous = seen.get(binding)
    if (previous) {
      issues.push({ action, message: `与“${shortcutLabels[previous]}”的快捷键重复。` })
      issues.push({ action: previous, message: `与“${shortcutLabels[action]}”的快捷键重复。` })
    } else seen.set(binding, action)
  }
  return issues
}

export function shortcutErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const action = 'action' in error ? error.action : null
    return isShortcutAction(action) ? `${shortcutLabels[action]}：${error.message}` : error.message
  }
  return '无法操作全局快捷键，请重试。'
}

export function parseGlobalShortcutSettings(value: unknown): GlobalShortcutSettings {
  if (!value || typeof value !== 'object' || !('bindings' in value) || !('issues' in value) || !('suspended' in value)) throw new Error('快捷键设置响应格式错误。')
  const { bindings, issues, suspended } = value
  if (!bindings || typeof bindings !== 'object' || !Array.isArray(issues) || typeof suspended !== 'boolean') throw new Error('快捷键设置响应格式错误。')
  for (const action of shortcutActions) {
    if (!(action in bindings) || (bindings[action as keyof typeof bindings] !== null && typeof bindings[action as keyof typeof bindings] !== 'string')) throw new Error('快捷键设置响应格式错误。')
  }
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object' || (issue.action !== null && !isShortcutAction(issue.action)) || typeof issue.message !== 'string') throw new Error('快捷键设置响应格式错误。')
  }
  return { bindings: bindings as ShortcutBindings, issues, suspended }
}
