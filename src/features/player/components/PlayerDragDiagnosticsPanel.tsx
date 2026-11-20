import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { freezePlayerDragDiagnostics, getPlayerDragDiagnosticsStatus, startPlayerDragDiagnostics, stopPlayerDragDiagnostics, subscribePlayerDragDiagnostics } from '@/features/player/diagnostics/playerDragDiagnostics'

export function PlayerDragDiagnosticsPanel() {
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState('')
  const [failed, setFailed] = useState(false)
  const savingRef = useRef(false)
  const status = useSyncExternalStore(subscribePlayerDragDiagnostics, getPlayerDragDiagnosticsStatus)
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.altKey && event.code === 'KeyD' && !event.repeat) {
        event.preventDefault()
        setVisible(current => !current)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  const save = async () => {
    if (savingRef.current) return
    const payload = freezePlayerDragDiagnostics()
    savingRef.current = true
    setSaving(true)
    setFailed(false)
    try {
      const path = await invoke<string>('player_drag_diagnostics_export', { input: { payload } })
      setSavedPath(path)
    } catch { setFailed(true) }
    finally { savingRef.current = false; setSaving(false) }
  }
  if (!visible) return null
  return <Card size="sm" className="fixed top-12 right-4 z-50 w-80" data-player-drag-diagnostics="">
    <CardHeader>
      <CardTitle>拖拽诊断</CardTitle>
      <CardDescription>开始记录后复现问题，再保存故障日志。</CardDescription>
      <CardAction><Button size="xs" variant="ghost" onClick={() => setVisible(false)} aria-label="隐藏拖拽诊断">隐藏</Button></CardAction>
    </CardHeader>
    <CardContent className="flex flex-col gap-2">
      <p role="status">{status.recording ? '正在记录' : status.frozen ? '故障记录已冻结' : '未在记录'} · 最多 {status.capacity} 条{status.capped ? '（已覆盖最早记录）' : ''}</p>
      <p className="text-muted-foreground">仅记录交互状态，不包含歌曲名称、文件路径或歌词。</p>
      <p className="text-muted-foreground">诊断版 v2 · 隐藏面板后仍会继续记录</p>
      {failed ? <p role="alert">保存失败，记录仍保留，请重试保存。</p> : null}
      {savedPath ? <><label htmlFor="player-drag-log-path">日志已保存，可复制路径</label><Input id="player-drag-log-path" readOnly value={savedPath} onFocus={event => event.currentTarget.select()} /></> : null}
    </CardContent>
    <CardFooter className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={saving || status.recording} onClick={() => { setSavedPath(''); setFailed(false); startPlayerDragDiagnostics() }}>开始记录</Button>
      <Button size="sm" variant="outline" disabled={saving || !status.recording} onClick={stopPlayerDragDiagnostics}>停止记录</Button>
      <Button size="sm" disabled={saving || !status.hasRecording} onPointerDown={event => { if (event.button === 0) { event.preventDefault(); freezePlayerDragDiagnostics() } }} onClick={() => { void save() }}>{saving ? '正在保存…' : failed ? '重试保存故障日志' : '记录故障并保存'}</Button>
    </CardFooter>
  </Card>
}
