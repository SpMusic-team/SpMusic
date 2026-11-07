import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import {
  defaultShortcutBindings, formatShortcut, shortcutActions, shortcutLabels, shortcutFromKeyEvent,
  shortcutErrorMessage, validateShortcutBindings,
  type GlobalShortcutSettings, type ShortcutAction, type ShortcutBindings,
} from '../model/globalShortcuts'
import { getGlobalShortcutSettings, setGlobalShortcutsSuspended, updateGlobalShortcutSettings } from '../services/globalShortcutCommands'

type Capture = { action: ShortcutAction; ready: boolean; code: string | null; binding: string | null }

export function GlobalShortcutSettings() {
  const [settings, setSettings] = useState<GlobalShortcutSettings | null>(null)
  const [draft, setDraft] = useState<ShortcutBindings>({ ...defaultShortcutBindings })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [needsRecovery, setNeedsRecovery] = useState(false)
  const captureRef = useRef<Capture | null>(null)
  const recoveryNeededRef = useRef(false)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const validation = validateShortcutBindings(draft)
  const dirty = settings && shortcutActions.some((action) => draft[action] !== settings.bindings[action])

  const finishRecording = useCallback(async () => {
    const generation = ++generationRef.current
    const isCurrent = () => mountedRef.current && generation === generationRef.current
    captureRef.current = null
    recoveryNeededRef.current = true
    if (mountedRef.current) { setRecording(null); setBusy(true) }
    try {
      const restored = await setGlobalShortcutsSuspended(false)
      recoveryNeededRef.current = restored.suspended
      if (isCurrent()) { setSettings(restored); setNeedsRecovery(restored.suspended) }
    } catch (reason: unknown) {
      const message = `恢复快捷键失败：${shortcutErrorMessage(reason)}`
      if (isCurrent()) { setError(message); setNeedsRecovery(true) }
      else if (!mountedRef.current) toast.error(message)
      // A focus-loss fallback may have restored native registrations even if IPC failed.
      // Read native state to reconcile the event gate and expose a retry if still suspended.
      try {
        const effective = await getGlobalShortcutSettings()
        recoveryNeededRef.current = effective.suspended
        if (isCurrent()) { setSettings(effective); setNeedsRecovery(effective.suspended) }
      } catch {
        // Keep the visible restore action and retry during cleanup when state is unknown.
      }
    } finally {
      if (isCurrent()) setBusy(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    let active = true
    void getGlobalShortcutSettings().then((loaded) => {
      if (!active) return
      setSettings(loaded)
      setDraft({ ...loaded.bindings })
    }).catch((reason: unknown) => {
      if (active) setError(shortcutErrorMessage(reason))
    }).finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
      mountedRef.current = false
      if (captureRef.current || recoveryNeededRef.current) void finishRecording()
    }
  }, [finishRecording])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const capture = captureRef.current
      if (!capture) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.code === 'Escape') { void finishRecording(); return }
      if (!capture.ready || capture.code || event.repeat || event.isComposing) return
      if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(event.code)) return
      const binding = shortcutFromKeyEvent(event)
      if (!binding) {
        setError('请使用 Ctrl、Alt 或 Super 加一个按键，可搭配 Shift；Esc 取消。')
        return
      }
      capture.code = event.code
      capture.binding = binding
      setError(null)
      setNotice(`已录制 ${formatShortcut(binding)}，松开所有按键后结束；保存后生效。`)
    }
    function onKeyUp(event: KeyboardEvent) {
      const capture = captureRef.current
      if (!capture) return
      event.preventDefault()
      event.stopImmediatePropagation()
      // Restore only after every modifier is released, avoiding a held-key action.
      if (capture.code && capture.binding && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        setDraft((previous) => ({ ...previous, [capture.action]: capture.binding }))
        void finishRecording()
      }
    }
    function onBlur() { if (captureRef.current) void finishRecording() }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [finishRecording])

  async function beginRecording(action: ShortcutAction) {
    const generation = ++generationRef.current
    captureRef.current = { action, ready: false, code: null, binding: null }
    setRecording(action)
    setBusy(true)
    setError(null)
    setNotice('正在暂停全局快捷键…')
    try {
      const paused = await setGlobalShortcutsSuspended(true)
      if (!mountedRef.current || generation !== generationRef.current) return
      if (!paused.suspended) throw new Error('全局快捷键未暂停，无法录制。')
      setSettings(paused)
      captureRef.current!.ready = true
      setNotice('请按快捷键组合，Esc 取消；录制期间全局快捷键已暂停。')
    } catch (reason: unknown) {
      if (mountedRef.current && generation === generationRef.current) {
        setError(shortcutErrorMessage(reason))
        await finishRecording()
      }
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await updateGlobalShortcutSettings(draft)
      if (!mountedRef.current) return
      setSettings(saved)
      setDraft({ ...saved.bindings })
      setNotice(saved.issues.length ? null : '快捷键已保存并生效。')
    } catch (reason: unknown) {
      if (!mountedRef.current) return
      setError(shortcutErrorMessage(reason))
      // A failed update can report rollback issues; refresh effective state while retaining the draft.
      try {
        const effective = await getGlobalShortcutSettings()
        if (mountedRef.current) setSettings(effective)
      } catch (refreshError: unknown) {
        if (mountedRef.current) setError(`${shortcutErrorMessage(reason)}；读取当前配置失败：${shortcutErrorMessage(refreshError)}`)
      }
    } finally { if (mountedRef.current) setBusy(false) }
  }

  const disabled = loading || busy || !settings || needsRecovery
  return (
    <FieldSet className="global-shortcut-settings" disabled={loading || !settings}>
      <FieldLegend>全局快捷键</FieldLegend>
      <FieldDescription>应用在后台也可使用。点击组合录制，清除可禁用该项。音量每次调整 5%。</FieldDescription>
      {loading ? <FieldDescription role="status">正在读取快捷键…</FieldDescription> : null}
      <FieldGroup>
        {shortcutActions.map((action) => {
          const issues = [...validation, ...(settings?.issues ?? [])].filter((issue) => issue.action === action)
          const id = `shortcut-${action}`
          return (
            <Field key={action} orientation="horizontal" data-invalid={issues.length > 0} data-disabled={disabled}>
              <FieldContent>
                <FieldLabel htmlFor={id}>{shortcutLabels[action]}</FieldLabel>
                <FieldDescription>默认：{formatShortcut(defaultShortcutBindings[action])}</FieldDescription>
                {issues.length ? <FieldError errors={issues} /> : null}
              </FieldContent>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <Button id={id} type="button" variant="outline" size="sm" aria-invalid={issues.length > 0} disabled={disabled} onClick={() => void beginRecording(action)}>
                  {recording === action ? '正在录制…' : formatShortcut(draft[action])}
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`清除${shortcutLabels[action]}快捷键`} disabled={disabled || draft[action] === null} onClick={() => {
                  setDraft((previous) => ({ ...previous, [action]: null }))
                  setNotice('快捷键已清除，保存后生效。')
                  setError(null)
                }}>清除</Button>
              </div>
            </Field>
          )
        })}
      </FieldGroup>
      {error ? <FieldError>{error}</FieldError> : null}
      {settings?.issues.filter((issue) => issue.action === null).map((issue, index) => <FieldError key={index}>{issue.message}</FieldError>)}
      {notice ? <FieldDescription role="status" aria-live="polite">{notice}</FieldDescription> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {recording ? <Button type="button" variant="outline" size="sm" onClick={() => void finishRecording()}>取消录制</Button> : null}
        {(settings?.suspended || needsRecovery) && !recording ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void finishRecording()}>恢复快捷键</Button> : null}
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => {
          setDraft({ ...defaultShortcutBindings })
          setError(null)
          setNotice('已恢复默认组合，保存后生效。')
        }}>恢复默认</Button>
        <Button type="button" size="sm" disabled={disabled || validation.length > 0 || (!dirty && !settings?.issues.length) || settings?.suspended} onClick={() => void save()}>保存快捷键</Button>
      </div>
    </FieldSet>
  )
}
