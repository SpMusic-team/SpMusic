// Opt-in, memory-only flight recorder. Callers pass explicit scalar state,
// never track/artwork objects, file paths, error messages, or media contents.
type Value = null | boolean | number | string | Value[] | { [key: string]: Value }
type Fields = Record<string, Value>
type Entry = { sequence: number; elapsedMs: number; event: string; fields: Fields }
export const PLAYER_DRAG_DIAGNOSTIC_CAPACITY = 10000
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
let recording = false
let startedAt = 0
let startedAtUtc: string | null = null
let sequence = 0
let dropped = 0
let salt = 0
let entries: Entry[] = []
let cursor = 0
let frozen: string | null = null
let errorCount = 0
let aggregatedCounts = { hydrationCacheHits: 0, resourceReferenceChangesAboveOne: 0 }
const providers = new Map<string, () => Fields>()
const subscribers = new Set<() => void>()
let status = { recording: false, frozen: false, hasRecording: false, capacity: PLAYER_DRAG_DIAGNOSTIC_CAPACITY, capped: false }
const notify = () => {
  status = { recording, frozen: frozen !== null, hasRecording: startedAtUtc !== null, capacity: PLAYER_DRAG_DIAGNOSTIC_CAPACITY, capped: dropped > 0 }
  for (const subscriber of subscribers) subscriber()
}
export const getPlayerDragDiagnosticsStatus = () => status
export const subscribePlayerDragDiagnostics = (subscriber: () => void) => {
  subscribers.add(subscriber)
  return () => { subscribers.delete(subscriber) }
}
export const isPlayerDragDiagnosticsRecording = () => recording

// Salt is regenerated per recording and is never exported. Identity equality
// remains useful within a report without exposing source paths or track IDs.
export function playerDragDiagnosticId(value: string | number | null | undefined): string | null {
  if (value == null) return null
  let hash = salt ^ 2166136261
  const original = String(value)
  const text = original.length > 1024 ? `${original.slice(0, 512)}:${original.length}:${original.slice(-512)}` : original
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return `id-${(hash >>> 0).toString(16)}`
}

function bounded(value: Value, depth = 0, budget = { remaining: 128 }): Value {
  if (depth > 4 || budget.remaining-- <= 0) return null
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null
  // Only fixed categorical strings and opaque diagnostic IDs are accepted.
  if (typeof value === 'string') return /^[a-zA-Z0-9_.:-]{1,96}$/.test(value) ? value : 'redacted'
  if (Array.isArray(value)) return value.slice(0, 32).map(item => bounded(item, depth + 1, budget))
  return Object.fromEntries(Object.entries(value).slice(0, 32).filter(([key]) => /^[a-zA-Z0-9_.:-]{1,64}$/.test(key) && !/path|title|lyric|message|metadata|error|name/i.test(key)).map(([key, item]) => [key, bounded(item, depth + 1, budget)]))
}

export function recordPlayerDragDiagnostic(event: string, fields: Fields = {}) {
  if (!recording) return
  if (event === 'hydration.cache-hit') { aggregatedCounts.hydrationCacheHits += 1; return }
  if (event === 'artwork.resource.references' && typeof fields.references === 'number' && fields.references > 1) { aggregatedCounts.resourceReferenceChangesAboveOne += 1; return }
  const entry = { sequence: ++sequence, elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000, event: /^[a-zA-Z0-9_.:-]{1,80}$/.test(event) ? event : 'redacted', fields: bounded(fields) as Fields }
  if (entries.length < PLAYER_DRAG_DIAGNOSTIC_CAPACITY) entries.push(entry)
  else {
    entries[cursor] = entry
    cursor = (cursor + 1) % PLAYER_DRAG_DIAGNOSTIC_CAPACITY
    dropped += 1
    if (dropped === 1) notify()
  }
}

export function registerPlayerDragDiagnosticSnapshot(name: string, snapshot: () => Fields) {
  if (!/^[a-zA-Z0-9_.:-]{1,64}$/.test(name)) return () => undefined
  providers.set(name, snapshot)
  return () => { if (providers.get(name) === snapshot) providers.delete(name) }
}
function snapshot(reason: string) {
  for (const [name, provider] of providers) {
    try { recordPlayerDragDiagnostic(`snapshot.${name}`, { reason, ...provider() }) }
    catch { recordPlayerDragDiagnostic('snapshot.failed', { provider: name }) }
  }
}
function finalSnapshot(): Fields {
  const result: Fields = {}
  for (const [name, provider] of providers) {
    try { result[name] = bounded(provider(), 0, { remaining: 512 }) }
    catch { result[name] = { failed: true } }
  }
  return result
}
const globalError = () => {
  if (recording && errorCount++ < 20) recordPlayerDragDiagnostic('window.error')
}
const rejectedPromise = () => {
  if (recording && errorCount++ < 20) recordPlayerDragDiagnostic('window.unhandledrejection')
}
function targetFacts(target: EventTarget | Node | null): Fields {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  const area = !element ? 'none' : element.closest('[data-player-drag-diagnostics]') ? 'diagnostics' : element.closest('.cover-input-region') ? 'cover-input' : element.closest('.cover-frame') ? 'cover' : element.closest('.track-pills') ? 'metadata' : element.closest('.lyrics-panel') ? 'lyrics' : element.closest('.window-bar') ? 'window-bar' : element.closest('.control-dock,.playlist-playback-dock') ? 'dock' : 'other'
  return { area, tag: element?.tagName.toLowerCase() ?? null, connected: element?.isConnected ?? false, draggable: element instanceof HTMLElement ? element.draggable : false }
}
export function playerDragDiagnosticInteractionFacts(target: EventTarget | null): Fields {
  const selection = window.getSelection()
  return {
    target: targetFacts(target), hasFocus: document.hasFocus(), hidden: document.hidden,
    selection: selection ? { type: selection.type, collapsed: selection.isCollapsed, rangeCount: selection.rangeCount, anchor: targetFacts(selection.anchorNode), focus: targetFacts(selection.focusNode) } : null,
  }
}
let lastRawScrollAt = 0
const rawTypes = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'dragstart', 'dragend', 'selectstart', 'focusin', 'focusout', 'blur', 'focus', 'contextmenu', 'scroll', 'wheel', 'visibilitychange'] as const
function recordRawEvent(event: Event, phase: 'capture' | 'bubble') {
  if (!recording) return
  if (event.type === 'scroll' || event.type === 'wheel') {
    if (performance.now() - lastRawScrollAt < 200) return
    lastRawScrollAt = performance.now()
  }
  const mouse = event instanceof MouseEvent ? event : null
  const pointer = event instanceof PointerEvent ? event : null
  recordPlayerDragDiagnostic('input.raw', {
    type: event.type, phase, trusted: event.isTrusted, defaultPrevented: event.defaultPrevented,
    buttons: mouse?.buttons ?? null, button: mouse?.button ?? null, detail: mouse?.detail ?? null,
    pointerId: pointer?.pointerId ?? null, pointerType: pointer?.pointerType ?? null,
    ...playerDragDiagnosticInteractionFacts(event.target),
  })
}
const rawCapture = (event: Event) => recordRawEvent(event, 'capture')
const rawMouseBubble = (event: Event) => recordRawEvent(event, 'bubble')
function addInputListeners() {
  for (const type of rawTypes) window.addEventListener(type, rawCapture, { capture: true, passive: true })
  window.addEventListener('mousedown', rawMouseBubble, { passive: true })
}
function removeInputListeners() {
  for (const type of rawTypes) window.removeEventListener(type, rawCapture, true)
  window.removeEventListener('mousedown', rawMouseBubble)
}
function removeErrorListeners() {
  window.removeEventListener('error', globalError)
  window.removeEventListener('unhandledrejection', rejectedPromise)
  removeInputListeners()
}
export function startPlayerDragDiagnostics() {
  removeErrorListeners()
  entries = []
  cursor = 0
  sequence = 0
  dropped = 0
  errorCount = 0
  aggregatedCounts = { hydrationCacheHits: 0, resourceReferenceChangesAboveOne: 0 }
  lastRawScrollAt = 0
  frozen = null
  salt = crypto.getRandomValues(new Uint32Array(1))[0]!
  startedAt = performance.now()
  startedAtUtc = new Date().toISOString()
  recording = true
  addInputListeners()
  window.addEventListener('error', globalError)
  window.addEventListener('unhandledrejection', rejectedPromise)
  recordPlayerDragDiagnostic('recording.start', { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, pixelRatio: window.devicePixelRatio })
  snapshot('start')
  notify()
}
export function stopPlayerDragDiagnostics() {
  if (recording) { snapshot('stop'); recordPlayerDragDiagnostic('recording.stop') }
  recording = false
  removeErrorListeners()
  notify()
}
export function freezePlayerDragDiagnostics(): string {
  if (frozen) return frozen
  // Capture the fault before button focus/render or the asynchronous IPC.
  const capturedSnapshot = finalSnapshot()
  if (recording) { snapshot('fault'); recordPlayerDragDiagnostic('recording.freeze') }
  recording = false
  removeErrorListeners()
  let ordered = cursor ? [...entries.slice(cursor), ...entries.slice(0, cursor)] : [...entries]
  const endedAtUtc = new Date().toISOString()
  const report = () => JSON.stringify({ schemaVersion: 1, buildMarker: 'drag-diagnostics-manual-v2', startedAt: startedAtUtc, endedAt: endedAtUtc, kind: 'player-drag', eventCapacity: PLAYER_DRAG_DIAGNOSTIC_CAPACITY, droppedCount: dropped, aggregatedCounts, elapsedMs: Math.round(performance.now() - startedAt), finalSnapshot: capturedSnapshot, events: ordered })
  let payload = report()
  while (new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES && ordered.length) {
    const count = Math.max(1, Math.ceil(ordered.length / 4))
    ordered = ordered.slice(count)
    dropped += count
    payload = report()
  }
  frozen = payload
  notify()
  return frozen
}
