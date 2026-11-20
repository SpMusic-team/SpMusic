import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultShortcutBindings, formatShortcut, isShortcutAction, isSupportedShortcutCode,
  parseGlobalShortcutSettings, shortcutActions, shortcutErrorMessage, shortcutFromKeyEvent,
  validateShortcutBindings, type ShortcutKeyEvent,
} from './globalShortcuts.ts'

const key = (code: string, overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  code, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false,
  isComposing: false, repeat: false, ...overrides,
})

test('five user defaults are canonical and display the requested arrow and P labels', () => {
  assert.deepEqual(defaultShortcutBindings, {
    previous: 'Ctrl+Alt+ArrowLeft', next: 'Ctrl+Alt+ArrowRight', volumeUp: 'Ctrl+Alt+ArrowUp',
    volumeDown: 'Ctrl+Alt+ArrowDown', togglePlayback: 'Ctrl+KeyP',
  })
  assert.equal(shortcutActions.length, 5)
  assert.deepEqual(validateShortcutBindings(defaultShortcutBindings), [])
  assert.deepEqual(Object.values(defaultShortcutBindings).map(formatShortcut), [
    'Ctrl + Alt + ←', 'Ctrl + Alt + →', 'Ctrl + Alt + ↑', 'Ctrl + Alt + ↓', 'Ctrl + P',
  ])
  assert.equal(formatShortcut(null), '未设置')
})

test('capture uses physical codes and stable modifier order for every modifier combination', () => {
  for (let mask = 1; mask < 16; mask += 1) {
    if (mask === 4) continue // Shift alone is deliberately excluded by the shared contract.
    const ctrlKey = Boolean(mask & 1), altKey = Boolean(mask & 2)
    const shiftKey = Boolean(mask & 4), metaKey = Boolean(mask & 8)
    const binding = shortcutFromKeyEvent(key('KeyP', { ctrlKey, altKey, shiftKey, metaKey }))
    const expected = [ctrlKey && 'Ctrl', altKey && 'Alt', shiftKey && 'Shift', metaKey && 'Super', 'KeyP'].filter(Boolean).join('+')
    assert.equal(binding, expected)
    assert.deepEqual(validateShortcutBindings({ ...defaultShortcutBindings, togglePlayback: binding }), [])
  }
  assert.equal(shortcutFromKeyEvent(key('Digit7', { altKey: true })), 'Ctrl+Alt+Digit7')
})

test('modifier-only, composition, auto-repeat, unsupported and unmodified inputs never record', () => {
  for (const code of ['ControlLeft', 'ShiftRight', 'AltLeft', 'MetaRight', 'Escape', 'Unidentified', 'F25', 'Numpad1']) {
    assert.equal(shortcutFromKeyEvent(key(code)), null, code)
  }
  for (const overrides of [{ isComposing: true }, { repeat: true }, { ctrlKey: false }, { ctrlKey: false, shiftKey: true }]) {
    assert.equal(shortcutFromKeyEvent(key('KeyP', overrides)), null)
  }
  for (const code of ['KeyA', 'KeyZ', 'Digit0', 'Digit9', 'F1', 'F24', 'ArrowLeft', 'Space', 'Backquote', 'PageDown']) {
    assert.equal(isSupportedShortcutCode(code), true, code)
  }
})

test('clear disables an action and duplicate bindings mark both affected actions', () => {
  assert.deepEqual(validateShortcutBindings({ ...defaultShortcutBindings, togglePlayback: null }), [])
  const duplicate = validateShortcutBindings({ ...defaultShortcutBindings, next: defaultShortcutBindings.previous })
  assert.deepEqual(duplicate.map((issue) => issue.action).sort(), ['next', 'previous'])
  for (const invalid of ['KeyP', 'Shift+KeyP', 'Ctrl', 'Ctrl+Ctrl+KeyP', 'Alt+Ctrl+KeyP', 'ctrl+KeyP', 'Ctrl+P', 'Ctrl+Escape', 'Ctrl+F0', 'Ctrl+F25', 'Ctrl+KeyP+', 'Ctrl++KeyP']) {
    const issues = validateShortcutBindings({ ...defaultShortcutBindings, togglePlayback: invalid })
    assert.equal(issues.length, 1, invalid)
    assert.equal(issues[0].action, 'togglePlayback', invalid)
  }
})

test('IPC responses preserve null and action/global issues and reject malformed envelopes', () => {
  const bindings = { ...defaultShortcutBindings, previous: null }
  const settings = { bindings, suspended: true, issues: [{ action: null, message: 'storage failed' }, { action: 'next', message: 'occupied' }] }
  assert.deepEqual(parseGlobalShortcutSettings(settings), settings)
  for (const response of [null, {}, { bindings, issues: [] }, { bindings, issues: [], suspended: 'false' },
    { bindings: { next: null }, issues: [], suspended: false },
    { bindings: { ...bindings, previous: 2 }, issues: [], suspended: false },
    { bindings, issues: [null], suspended: false },
    { bindings, issues: [{ action: 'unknown', message: 'failure' }], suspended: false },
    { bindings, issues: [{ action: null, message: 2 }], suspended: false },
  ]) assert.throws(() => parseGlobalShortcutSettings(response), /响应格式错误/)
  for (const action of shortcutActions) assert.equal(isShortcutAction(action), true)
  for (const action of [null, 'constructor', '__proto__', 'pause', 1]) assert.equal(isShortcutAction(action), false)
})

test('error messages expose backend failures and provide a fallback for unknown values', () => {
  assert.equal(shortcutErrorMessage(new Error('native failed')), 'native failed')
  assert.equal(shortcutErrorMessage({ message: 'save failed', code: 'PERSIST_FAILED' }), 'save failed')
  assert.equal(shortcutErrorMessage('occupied'), 'occupied')
  assert.match(shortcutErrorMessage(undefined), /无法操作全局快捷键/)
})
