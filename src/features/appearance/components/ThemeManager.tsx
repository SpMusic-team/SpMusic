import { useEffect, useRef, useState } from 'react'
import {
  CopyIcon,
  DownloadIcon,
  PaletteIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { WorkspaceDialogContent } from '@/components/ui/workspace-dialog'
import { useAppearance } from '../hooks/useAppearance'
import { findBuiltinAppearance } from '../model/builtinAppearances'
import {
  cloneAppearance,
  deserializeAppearanceTheme,
  serializeAppearanceTheme,
} from '../model/appearanceThemeCodec'
import { defaultAppearance } from '../model/defaultAppearance'
import type {
  AppearanceColors,
  AppearanceComponents,
  AppearancePlayer,
  AppearancePreset,
  AppearanceResource,
  AppearanceThemeMetadata,
  AppearanceTypography,
  ColorSchemePreference,
} from '../model/appearanceTypes'
import { IconButton } from '@/features/player/components/IconButton'

const colorLabels: Record<keyof AppearanceColors, string> = {
  background: '应用背景',
  surface: '表面',
  surfaceMuted: '次级表面',
  text: '正文',
  textMuted: '次要文字',
  textStrong: '强调文字',
  border: '边框',
  accent: '强调色',
  accentSoft: '柔和强调色',
  accentContrast: '强调色前景',
  playerBlue: '播放器主色',
  playerBlueSoft: '播放器柔和色',
  playerBlueInk: '播放器强调文字',
  playerInk: '播放器正文',
  playerMuted: '播放器次要文字',
  playerOverlay: '背景遮罩',
  playerDock: '控制面板',
}

const radiusLabels: Record<keyof AppearancePreset['radii'], string> = {
  sm: '小圆角', md: '中圆角', lg: '大圆角', pill: '胶囊圆角',
}

const fontOptions: Array<{ label: string; value: AppearanceTypography['fontFamily'] }> = [
  { label: 'Geist', value: 'geist' },
  { label: '系统字体', value: 'system' },
  { label: '衬线字体', value: 'serif' },
  { label: '等宽字体', value: 'monospace' },
]
const tierOptions: Array<{ label: string; value: AppearanceThemeMetadata['tier'] }> = [
  { label: '普通', value: 'standard' },
  { label: '高级', value: 'advanced' },
  { label: '实验', value: 'experimental' },
]
const surfaceOptions: Array<{ label: string; value: AppearanceComponents['surface'] }> = [
  { label: '玻璃', value: 'glass' }, { label: '实色', value: 'solid' }, { label: '扁平', value: 'flat' },
]
const buttonOptions: Array<{ label: string; value: AppearanceComponents['buttons'] }> = [
  { label: '柔和', value: 'soft' }, { label: '描边', value: 'outline' }, { label: '极简', value: 'minimal' },
]
const windowOptions: Array<{ label: string; value: AppearanceComponents['windowControls'] }> = [
  { label: '标准', value: 'standard' }, { label: '紧凑', value: 'compact' }, { label: '交通灯', value: 'traffic-lights' },
]
const motionOptions = [
  { label: '关闭', value: 'off' }, { label: '轻柔', value: 'subtle' }, { label: '表现力', value: 'expressive' },
] as const
const easingOptions = [
  { label: 'SpMusic 平滑', value: 'cubic-bezier(.65, 0, .35, 1)' },
  { label: '标准', value: 'ease' },
  { label: '线性', value: 'linear' },
  { label: '缓入', value: 'ease-in' },
  { label: '缓出', value: 'ease-out' },
  { label: '缓入缓出', value: 'ease-in-out' },
] as const
const iconOptions = [
  { label: 'SpMusic', value: 'default' }, { label: 'Fluent', value: 'fluent' }, { label: 'iOS', value: 'ios' },
] as const
const colorSchemeOptions = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
] as const
const playerBackgroundOptions = [
  { label: '封面氛围', value: 'cover-ambient' },
  { label: '主题渐变', value: 'theme-gradient' },
  { label: '纯色', value: 'solid' },
  { label: '关闭', value: 'off' },
] as const
const activeLyricEmphasisOptions = [
  { label: '加粗', value: 'bold' },
  { label: '放大', value: 'scale' },
  { label: '强调色', value: 'accent' },
  { label: '组合', value: 'combined' },
] as const
const booleanOptions = [
  { label: '显示', value: 'true' },
  { label: '隐藏', value: 'false' },
] as const
const hexColorPattern = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

type Option = { label: string; value: string }

function colorPickerValue(value: string) {
  return /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000'
}

function colorWithPreservedAlpha(previous: string, rgb: string) {
  return hexColorPattern.test(previous) && previous.length === 9
    ? `${rgb}${previous.slice(7)}`
    : rgb
}

function ColorField({
  id,
  label,
  description,
  value,
  onChange,
  onPickerChange,
}: {
  id: string
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  onPickerChange: (value: string) => void
}) {
  const [localValue, setLocalValue] = useState(value)
  const [lastExternalValue, setLastExternalValue] = useState(value)
  if (value !== lastExternalValue) {
    setLastExternalValue(value)
    setLocalValue(value)
  }

  const valid = hexColorPattern.test(localValue)
  return (
    <Field data-invalid={!valid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          aria-invalid={!valid}
          value={localValue}
          onChange={(event) => {
            setLocalValue(event.target.value)
            onChange(event.target.value)
          }}
        />
        <Input
          className="size-8 shrink-0 cursor-pointer p-0.5"
          type="color"
          aria-label={`${label}取色器`}
          value={colorPickerValue(localValue)}
          onChange={(event) => {
            const next = colorWithPreservedAlpha(localValue, event.target.value)
            setLocalValue(next)
            onPickerChange(next)
          }}
        />
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

function OptionField({ id, label, description, disabled = false, value, options, onChange }: { id: string; label: string; description?: string; disabled?: boolean; value: string; options: readonly Option[]; onChange: (value: string) => void }) {
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select disabled={disabled} items={options} value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

function SliderField({
  id,
  label,
  description,
  disabled = false,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '%',
  onChange,
}: {
  id: string
  label: string
  description: string
  disabled?: boolean
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}) {
  function commitValue(candidate: number) {
    if (!Number.isFinite(candidate)) return
    onChange(Math.min(max, Math.max(min, candidate)))
  }

  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={`${id}-value`}>{label}</FieldLabel>
      <div className="flex items-center gap-3">
        <Slider
          id={id}
          disabled={disabled}
          getAriaLabel={() => label}
          getAriaValueText={(_, nextValue) => `${nextValue}${unit}`}
          max={max}
          min={min}
          step={step}
          value={[value]}
          onValueChange={(nextValue) => commitValue(Array.isArray(nextValue) ? (nextValue[0] ?? min) : nextValue)}
        />
        <div className="flex w-24 shrink-0 items-center gap-1">
          <Input
            id={`${id}-value`}
            aria-label={`${label}数值`}
            disabled={disabled}
            inputMode="decimal"
            max={max}
            min={min}
            step={step}
            type="number"
            value={value}
            onChange={(event) => commitValue(Number(event.target.value))}
          />
          <span className="text-sm text-muted-foreground" aria-hidden="true">{unit}</span>
        </div>
      </div>
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )
}

function inferCapabilities(theme: AppearancePreset): AppearanceThemeMetadata['capabilities'] {
  const result: AppearanceThemeMetadata['capabilities'] = ['tokens']
  if (theme.metadata.tier !== 'standard' || theme.advanced.customCss) result.push('custom-css')
  if (theme.metadata.tier === 'experimental' || theme.experimental.layoutCss) result.push('layout-overrides')
  if (theme.experimental.resources.length) result.push('local-resources')
  return result
}

type ThemeManagerProps = {
  onOpenChange?: (open: boolean) => void
}

export function ThemeManager({ onOpenChange }: ThemeManagerProps) {
  const appearanceContext = useAppearance()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const colorFrameRef = useRef<number | null>(null)
  const pendingColorDraftRef = useRef<AppearancePreset | null>(null)
  const [open, setOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [draft, setDraft] = useState(() => cloneAppearance(appearanceContext.appearance))
  const draftRef = useRef(draft)
  const [draftColorSchemePreference, setDraftColorSchemePreference] = useState<ColorSchemePreference>(appearanceContext.colorSchemePreference)
  const [selectedThemeId, setSelectedThemeId] = useState(appearanceContext.activeThemeId)
  const [riskConfirmed, setRiskConfirmed] = useState(false)
  const [resourcesText, setResourcesText] = useState(() => JSON.stringify(appearanceContext.appearance.experimental.resources, null, 2))
  const [status, setStatus] = useState<string | null>(appearanceContext.storageWarning ?? null)
  const themeOptions = appearanceContext.themes.map((entry) => ({
    label: `${entry.appearance.name}${entry.builtin ? '（内置）' : ''}`,
    value: entry.appearance.id,
  }))
  if (!themeOptions.some((option) => option.value === selectedThemeId)) themeOptions.push({ label: `${draft.name}（草稿）`, value: selectedThemeId })
  const selectedTheme = appearanceContext.themes.find((entry) => entry.appearance.id === selectedThemeId)
  const selectedBuiltin = selectedTheme?.builtin ?? false
  const selectedPersistedUser = appearanceContext.themes.some((entry) => !entry.builtin && entry.appearance.id === selectedThemeId)
  const backgroundBlurDisabled = draft.player.backgroundEffect !== 'cover-ambient'
  const backgroundMaskDisabled = draft.player.backgroundEffect === 'off'
  const backgroundVisualDisabled = draft.player.backgroundEffect === 'off'
  const playerColorScheme = appearanceContext.resolvedColorScheme
  const playerOverlayColor = draft.colorSchemes[playerColorScheme].playerOverlay

  function safePreview(next: AppearancePreset, confirmed = riskConfirmed) {
    const result = deserializeAppearanceTheme(serializeAppearanceTheme(next))
    if (!result.ok) return
    if (result.appearance.metadata.tier !== 'standard' && !confirmed) {
      result.appearance.advanced.customCss = ''
      result.appearance.experimental.layoutCss = ''
      result.appearance.experimental.resources = []
    }
    appearanceContext.previewAppearance(result.appearance)
  }

  function cancelScheduledColorCommit() {
    if (colorFrameRef.current !== null) cancelAnimationFrame(colorFrameRef.current)
    colorFrameRef.current = null
    pendingColorDraftRef.current = null
  }

  function replaceDraft(next: AppearancePreset) {
    cancelScheduledColorCommit()
    draftRef.current = next
    setDraft(next)
  }

  function commitPendingColorDraft() {
    const next = pendingColorDraftRef.current
    cancelScheduledColorCommit()
    if (!next) return draftRef.current
    draftRef.current = next
    setDraft(next)
    safePreview(next)
    return next
  }

  function updateDraftColor(update: (next: AppearancePreset) => void) {
    const next = cloneAppearance(draftRef.current)
    update(next)
    next.metadata.capabilities = inferCapabilities(next)
    draftRef.current = next
    pendingColorDraftRef.current = next
    if (colorFrameRef.current !== null) return
    colorFrameRef.current = requestAnimationFrame(() => {
      colorFrameRef.current = null
      const pending = pendingColorDraftRef.current
      pendingColorDraftRef.current = null
      if (!pending) return
      draftRef.current = pending
      setDraft(pending)
      safePreview(pending)
    })
  }

  function updateDraft(update: (next: AppearancePreset) => void) {
    const next = cloneAppearance(draftRef.current)
    update(next)
    next.metadata.capabilities = inferCapabilities(next)
    replaceDraft(next)
    safePreview(next)
  }

  useEffect(() => () => cancelScheduledColorCommit(), [])

  function openManager() {
    const active = appearanceContext.themes.find((entry) => entry.appearance.id === appearanceContext.activeThemeId)?.appearance ?? appearanceContext.appearance
    replaceDraft(cloneAppearance(active))
    setResourcesText(JSON.stringify(active.experimental.resources, null, 2))
    setSelectedThemeId(active.id)
    setRiskConfirmed(active.metadata.tier === 'standard' || active.metadata.riskAcknowledged)
    setDraftColorSchemePreference(appearanceContext.colorSchemePreference)
    setStatus(appearanceContext.storageWarning ?? null)
    setOpen(true)
    onOpenChange?.(true)
  }

  function chooseTheme(id: string) {
    const selected = appearanceContext.themes.find((entry) => entry.appearance.id === id)?.appearance
    if (!selected) return
    const next = cloneAppearance(selected)
    const confirmed = next.metadata.tier === 'standard' || next.metadata.riskAcknowledged
    setSelectedThemeId(id)
    replaceDraft(next)
    setResourcesText(JSON.stringify(next.experimental.resources, null, 2))
    setRiskConfirmed(confirmed)
    safePreview(next, confirmed)
    setStatus(null)
  }

  function changeTier(tier: AppearanceThemeMetadata['tier']) {
    const confirmed = tier === 'standard'
    setRiskConfirmed(confirmed)
    const next = cloneAppearance(draftRef.current)
    next.metadata.tier = tier
    next.metadata.riskAcknowledged = confirmed
    next.metadata.capabilities = inferCapabilities(next)
    replaceDraft(next)
    safePreview(next, confirmed)
  }

  function confirmRisk() {
    setRiskConfirmed(true)
    const next = cloneAppearance(draftRef.current)
    next.metadata.riskAcknowledged = true
    next.metadata.capabilities = inferCapabilities(next)
    replaceDraft(next)
    safePreview(next, true)
    setStatus('已确认高级主题风险；CSS 将实时作用于预览。')
  }

  function applyDraft() {
    const currentDraft = commitPendingColorDraft()
    if (currentDraft.metadata.tier !== 'standard' && !riskConfirmed) {
      setStatus('应用高级或实验主题前必须确认风险。')
      toast.error('请先确认主题风险')
      return
    }
    const invalidOverlaySchemes = (['light', 'dark'] as const)
      .filter((scheme) => !hexColorPattern.test(currentDraft.colorSchemes[scheme].playerOverlay))
    if (invalidOverlaySchemes.length) {
      const schemeNames = invalidOverlaySchemes.map((scheme) => scheme === 'dark' ? '深色' : '浅色').join('、')
      const message = `${schemeNames}背景遮罩颜色无效，请使用 #RRGGBB 或 #RRGGBBAA。`
      setStatus(message)
      toast.error('请修正背景遮罩颜色')
      return
    }
    const candidate = cloneAppearance(currentDraft)
    candidate.metadata.riskAcknowledged = candidate.metadata.tier === 'standard' ? false : riskConfirmed
    candidate.metadata.capabilities = inferCapabilities(candidate)
    const validated = deserializeAppearanceTheme(serializeAppearanceTheme(candidate))
    if (!validated.ok) {
      setStatus(validated.error)
      toast.error(validated.error)
      return
    }

    const sourceTheme = appearanceContext.themes.find((entry) => entry.appearance.id === selectedThemeId)?.appearance
    const unchangedBuiltin = selectedBuiltin && sourceTheme && JSON.stringify(sourceTheme) === JSON.stringify(validated.appearance)
    if (unchangedBuiltin) {
      appearanceContext.selectTheme(selectedThemeId)
    } else {
      appearanceContext.saveAndApplyAppearance(validated.appearance)
    }
    appearanceContext.setColorSchemePreference(draftColorSchemePreference)
    if (validated.warnings.length) toast.warning(`主题已应用，含 ${validated.warnings.length} 条回退提示`)
    else toast.success('主题已应用')
    setOpen(false)
    onOpenChange?.(false)
  }

  function cancel() {
    cancelScheduledColorCommit()
    appearanceContext.cancelPreview()
    setOpen(false)
    onOpenChange?.(false)
  }

  function duplicate() {
    const duplicateTheme = cloneAppearance(draft)
    duplicateTheme.id = `${draft.id.slice(0, 38).replace(/-+$/, '')}-copy-${Date.now()}`
    duplicateTheme.name = `${draft.name} 副本`
    duplicateTheme.metadata.author = '用户'
    replaceDraft(cloneAppearance(duplicateTheme))
    setSelectedThemeId(duplicateTheme.id)
    setResourcesText(JSON.stringify(duplicateTheme.experimental.resources, null, 2))
    setRiskConfirmed(duplicateTheme.metadata.tier === 'standard' || duplicateTheme.metadata.riskAcknowledged)
    safePreview(duplicateTheme, duplicateTheme.metadata.tier === 'standard' || duplicateTheme.metadata.riskAcknowledged)
    setStatus('已创建主题副本草稿；点击“应用”后保存。')
    toast.success('已创建主题副本草稿')
  }

  function remove() {
    const restoredBuiltin = findBuiltinAppearance(selectedThemeId)
    if (!appearanceContext.deleteAppearance(selectedThemeId)) return
    const next = restoredBuiltin ?? defaultAppearance
    setDeleteDialogOpen(false)
    replaceDraft(cloneAppearance(next))
    setSelectedThemeId(next.id)
    setResourcesText(JSON.stringify(next.experimental.resources, null, 2))
    setRiskConfirmed(next.metadata.tier === 'standard' || next.metadata.riskAcknowledged)
    setStatus(restoredBuiltin ? '用户主题覆盖已删除，已恢复原内置主题。' : '用户主题已删除。')
    toast.success('已删除主题')
  }

  function reset() {
    appearanceContext.resetDefault()
    replaceDraft(cloneAppearance(defaultAppearance))
    setSelectedThemeId(defaultAppearance.id)
    setResourcesText('[]')
    setRiskConfirmed(true)
    setStatus('已恢复默认主题。')
    toast.success('已恢复默认主题')
  }

  async function importFile(file: File) {
    if (file.size > 1_000_000) {
      setStatus('主题文件超过 1MB，未导入。')
      toast.error('主题文件过大')
      return
    }
    const result = deserializeAppearanceTheme(await file.text())
    if (!result.ok) {
      setStatus(result.error)
      toast.error(result.error)
      return
    }
    const requiresConfirmation = result.appearance.metadata.tier !== 'standard'
    replaceDraft(result.appearance)
    setSelectedThemeId(result.appearance.id)
    setResourcesText(JSON.stringify(result.appearance.experimental.resources, null, 2))
    setRiskConfirmed(false)
    safePreview(result.appearance, !requiresConfirmation)
    const warningMessage = result.warnings.length ? `；${result.warnings.length} 个字段已回退` : ''
    setStatus(`已读取“${result.appearance.name}”${warningMessage}${requiresConfirmation ? '；应用前需确认风险' : ''}`)
    toast.success('主题文件已读取')
  }

  function updateResources(value: string) {
    setResourcesText(value)
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) throw new Error('资源必须是 JSON 数组')
      const candidate = cloneAppearance(draftRef.current)
      candidate.experimental.resources = parsed as AppearanceResource[]
      candidate.metadata.capabilities = inferCapabilities(candidate)
      const validated = deserializeAppearanceTheme(serializeAppearanceTheme(candidate))
      if (!validated.ok) throw new Error(validated.error)
      replaceDraft(validated.appearance)
      safePreview(validated.appearance)
      setStatus(validated.warnings.length ? `资源已解析，${validated.warnings.length} 项内容被忽略或回退。` : '资源模型有效。')
    } catch (error) {
      setStatus(error instanceof Error ? `资源 JSON 尚无效：${error.message}` : '资源 JSON 尚无效')
    }
  }

  function exportDraft() {
    const currentDraft = commitPendingColorDraft()
    const blob = new Blob([serializeAppearanceTheme(currentDraft)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${currentDraft.id}.spmusic-theme.json`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('主题已导出')
  }

  return (
    <>
      <IconButton icon={PaletteIcon} label="主题管理" onClick={openManager} />
      <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? openManager() : cancel()}>
        <WorkspaceDialogContent
          open={open}
          title="主题工作室"
          description="管理内置与用户主题，实时预览 tokens、组件变体和受控 CSS。"
          className="theme-manager-dialog h-[calc(100svh-2rem)] w-[min(580px,calc(100vw-2rem))] sm:max-w-[min(580px,calc(100vw-2rem))]"
          bodyClassName="flex flex-col gap-4 p-4"
          overlayClassName="theme-manager-overlay"
          initialPlacement="top-right"
          draggable
          closeLabel="关闭主题工作室"
          footer={(
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={draft.metadata.tier === 'standard' ? 'secondary' : 'destructive'}>{draft.metadata.tier}</Badge>
                <span className="min-w-0 flex-1 text-sm text-muted-foreground" role="status">{status ?? '更改会实时预览；点击“取消”可完整恢复。'}</span>
              </div>
              <Separator />
              <div className="flex flex-wrap justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <input ref={fileInputRef} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = '' }} />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}><UploadIcon data-icon="inline-start" />导入</Button>
                  <Button variant="outline" onClick={exportDraft}><DownloadIcon data-icon="inline-start" />导出</Button>
                  <Button variant="outline" onClick={reset}><RotateCcwIcon data-icon="inline-start" />恢复默认</Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={cancel}>取消</Button>
                  <Button onClick={applyDraft}><SaveIcon data-icon="inline-start" />应用</Button>
                </div>
              </div>
            </div>
          )}
        >
          <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Select items={themeOptions} value={selectedThemeId} onValueChange={(value) => value && chooseTheme(value)}>
              <SelectTrigger className="w-full" aria-label="当前主题"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>{themeOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
              </SelectContent>
            </Select>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" aria-label="复制主题" onClick={duplicate}><CopyIcon data-icon="inline-start" /></Button>
              <Button variant="outline" size="icon" aria-label="删除主题" disabled={selectedBuiltin || !selectedPersistedUser} onClick={() => setDeleteDialogOpen(true)}><Trash2Icon data-icon="inline-start" /></Button>
            </div>
          </div>

          <Tabs className="min-h-0" defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">常规</TabsTrigger>
              <TabsTrigger value="player">播放器</TabsTrigger>
              <TabsTrigger value="tokens">Tokens</TabsTrigger>
              <TabsTrigger value="advanced">高级</TabsTrigger>
              <TabsTrigger value="experimental">实验</TabsTrigger>
            </TabsList>
            <TabsContent value="general">
                <div className="flex flex-col gap-4 py-2">
                  <Card>
                    <CardHeader><CardTitle>配色模式</CardTitle><CardDescription>可固定浅色或深色，也可实时跟随操作系统外观。</CardDescription></CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <OptionField
                          id="color-scheme-preference"
                          label="应用配色"
                          value={draftColorSchemePreference}
                          options={colorSchemeOptions}
                          onChange={(value) => {
                            const preference = value as ColorSchemePreference
                            setDraftColorSchemePreference(preference)
                            appearanceContext.previewColorSchemePreference(preference)
                          }}
                        />
                        <FieldDescription>当前预览解析为{appearanceContext.resolvedColorScheme === 'dark' ? '深色' : '浅色'}；系统外观变化会立即更新。</FieldDescription>
                      </FieldGroup>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle>主题信息</CardTitle><CardDescription>名称、作者和能力等级会完整写入导出文件。</CardDescription></CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <Field><FieldLabel htmlFor="theme-name">名称</FieldLabel><Input id="theme-name" value={draft.name} maxLength={80} onChange={(event) => updateDraft((next) => { next.name = event.target.value })} /></Field>
                        <Field><FieldLabel htmlFor="theme-author">作者</FieldLabel><Input id="theme-author" value={draft.metadata.author} maxLength={80} onChange={(event) => updateDraft((next) => { next.metadata.author = event.target.value })} /></Field>
                        <Field><FieldLabel htmlFor="theme-description">说明</FieldLabel><Textarea id="theme-description" value={draft.metadata.description} maxLength={500} onChange={(event) => updateDraft((next) => { next.metadata.description = event.target.value })} /></Field>
                        <OptionField id="theme-tier" label="能力等级" value={draft.metadata.tier} options={tierOptions} onChange={(value) => changeTier(value as AppearanceThemeMetadata['tier'])} />
                      </FieldGroup>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle>组件与动效</CardTitle><CardDescription>这些变体通过 data attributes 和语义 tokens 作用于播放器与弹窗。</CardDescription></CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <OptionField id="theme-font" label="字体" value={draft.typography.fontFamily} options={fontOptions} onChange={(value) => updateDraft((next) => { next.typography.fontFamily = value as AppearanceTypography['fontFamily'] })} />
                        <Field><FieldLabel htmlFor="theme-font-scale">字号倍率</FieldLabel><Input id="theme-font-scale" type="number" min="0.75" max="1.5" step="0.05" value={draft.typography.fontScale} onChange={(event) => updateDraft((next) => { next.typography.fontScale = Number(event.target.value) })} /><FieldDescription>允许 0.75–1.5。</FieldDescription></Field>
                        <OptionField id="theme-motion" label="动效" value={draft.motion.level} options={motionOptions} onChange={(value) => updateDraft((next) => { next.motion.level = value as AppearancePreset['motion']['level'] })} />
                        <Field><FieldLabel htmlFor="theme-motion-scale">动效速度倍率</FieldLabel><Input id="theme-motion-scale" type="number" min="0.25" max="3" step="0.05" value={draft.motion.durationScale} onChange={(event) => updateDraft((next) => { next.motion.durationScale = Number(event.target.value) })} /></Field>
                        <OptionField id="theme-easing" label="缓动曲线" value={draft.motion.easing} options={easingOptions} onChange={(value) => updateDraft((next) => { next.motion.easing = value as AppearancePreset['motion']['easing'] })} />
                        <OptionField id="theme-icons" label="图标包" value={draft.icons.provider} options={iconOptions} onChange={(value) => updateDraft((next) => { next.icons.provider = value as AppearancePreset['icons']['provider'] })} />
                        <OptionField id="theme-surface" label="表面风格" value={draft.components.surface} options={surfaceOptions} onChange={(value) => updateDraft((next) => { next.components.surface = value as AppearanceComponents['surface'] })} />
                        <OptionField id="theme-buttons" label="按钮风格" value={draft.components.buttons} options={buttonOptions} onChange={(value) => updateDraft((next) => { next.components.buttons = value as AppearanceComponents['buttons'] })} />
                        <OptionField id="theme-window-controls" label="窗口按钮" value={draft.components.windowControls} options={windowOptions} onChange={(value) => updateDraft((next) => { next.components.windowControls = value as AppearanceComponents['windowControls'] })} />
                      </FieldGroup>
                    </CardContent>
                  </Card>
                </div>
            </TabsContent>

            <TabsContent value="player">
                <div className="flex flex-col gap-4 py-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>背景与封面</CardTitle>
                      <CardDescription>调整播放器舞台的氛围层与封面外观，不会改动主题颜色 token。</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <OptionField
                          id="player-background-effect"
                          label="播放器背景效果"
                          description="封面氛围使用当前专辑图；主题渐变使用主题色过渡，纯色使用柔和强调色，关闭则仅保留应用背景。"
                          value={draft.player.backgroundEffect}
                          options={playerBackgroundOptions}
                          onChange={(value) => updateDraft((next) => { next.player.backgroundEffect = value as AppearancePlayer['backgroundEffect'] })}
                        />
                        <SliderField
                          id="player-background-blur"
                          label="背景模糊强度"
                          description={backgroundBlurDisabled
                            ? '仅“封面氛围”使用封面背景并支持模糊；当前背景无需模糊。'
                            : '连续调节 0–100%；只作用于封面氛围背景。'}
                          disabled={backgroundBlurDisabled}
                          value={draft.player.backgroundBlur}
                          onChange={(value) => updateDraft((next) => { next.player.backgroundBlur = value })}
                        />
                        <SliderField
                          id="player-background-brightness"
                          label="背景亮度"
                          description={backgroundVisualDisabled
                            ? '背景效果已关闭，因此亮度不会渲染；切换到其他背景后可调整。'
                            : '连续调节 0–200%；100% 保持原始亮度。'}
                          disabled={backgroundVisualDisabled}
                          max={200}
                          value={draft.player.backgroundBrightness}
                          onChange={(value) => updateDraft((next) => { next.player.backgroundBrightness = value })}
                        />
                        <SliderField
                          id="player-background-saturation"
                          label="背景饱和度"
                          description={backgroundVisualDisabled
                            ? '背景效果已关闭，因此饱和度不会渲染；切换到其他背景后可调整。'
                            : '连续调节 0–200%；0% 为灰度，100% 为原始饱和度。'}
                          disabled={backgroundVisualDisabled}
                          max={200}
                          value={draft.player.backgroundSaturation}
                          onChange={(value) => updateDraft((next) => { next.player.backgroundSaturation = value })}
                        />
                        <SliderField
                          id="player-background-mask-opacity"
                          label="背景遮罩强度"
                          description={backgroundMaskDisabled
                            ? '背景效果已关闭，因此遮罩不会渲染；切换到其他背景后可调整。'
                            : '连续调节 0–100%；颜色与强度相互独立。'}
                          disabled={backgroundMaskDisabled}
                          value={draft.player.backgroundMaskOpacity}
                          onChange={(value) => updateDraft((next) => { next.player.backgroundMaskOpacity = value })}
                        />
                        <SliderField
                          id="player-background-vignette"
                          label="暗角强度"
                          description={backgroundVisualDisabled
                            ? '背景效果已关闭，因此暗角不会渲染；切换到其他背景后可调整。'
                            : '连续调节 0–100%；只压暗背景边缘，不影响封面、歌词和控件。'}
                          disabled={backgroundVisualDisabled}
                          value={draft.player.backgroundVignette}
                          onChange={(value) => updateDraft((next) => { next.player.backgroundVignette = value })}
                        />
                        <ColorField
                          id="player-background-mask-color"
                          label={`背景遮罩颜色（当前${playerColorScheme === 'dark' ? '深色' : '浅色'}）`}
                          description="与 Tokens 使用同一字段；接受 #RRGGBB 或 #RRGGBBAA。切换应用配色后可分别设置浅色和深色。"
                          value={playerOverlayColor}
                          onChange={(value) => updateDraft((next) => { next.colorSchemes[playerColorScheme].playerOverlay = value })}
                          onPickerChange={(value) => updateDraftColor((next) => { next.colorSchemes[playerColorScheme].playerOverlay = value })}
                        />
                        <SliderField
                          id="player-cover-radius"
                          label="封面圆角"
                          description="连续调节 0–100%；0% 为直角，响应式布局会按比例缩放。"
                          value={draft.player.coverRadius}
                          onChange={(value) => updateDraft((next) => { next.player.coverRadius = value })}
                        />
                        <SliderField
                          id="player-cover-shadow"
                          label="封面阴影"
                          description="连续调节 0–100%；0% 完全关闭，数值越大投影越明显。"
                          value={draft.player.coverShadow}
                          onChange={(value) => updateDraft((next) => { next.player.coverShadow = value })}
                        />
                      </FieldGroup>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>歌词与音量</CardTitle>
                      <CardDescription>控制播放器中的歌词可读性与音量面板显示，不改变真实播放状态。</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="player-lyrics-font-scale">歌词字号</FieldLabel>
                          <Input
                            id="player-lyrics-font-scale"
                            type="number"
                            min="0.75"
                            max="1.5"
                            step="0.05"
                            value={draft.player.lyricsFontScale}
                            onChange={(event) => updateDraft((next) => { next.player.lyricsFontScale = Number(event.target.value) })}
                          />
                          <FieldDescription>允许 0.75–1.5 倍，同时缩放原文与翻译。</FieldDescription>
                        </Field>
                        <OptionField
                          id="player-active-lyric-emphasis"
                          label="当前歌词强调方式"
                          description="组合会同时采用当前默认界面的加粗与放大效果。"
                          value={draft.player.activeLyricEmphasis}
                          options={activeLyricEmphasisOptions}
                          onChange={(value) => updateDraft((next) => { next.player.activeLyricEmphasis = value as AppearancePlayer['activeLyricEmphasis'] })}
                        />
                        <OptionField
                          id="player-volume-percent"
                          label="音量百分比显示"
                          description="隐藏时只移除数值文本；滑块读屏数值与真实音量控制保持不变。"
                          value={String(draft.player.showVolumePercent)}
                          options={booleanOptions}
                          onChange={(value) => updateDraft((next) => { next.player.showVolumePercent = value === 'true' })}
                        />
                      </FieldGroup>
                    </CardContent>
                  </Card>
                </div>
            </TabsContent>

            <TabsContent value="tokens">
                <div className="flex flex-col gap-4 py-2">
                  {(['light', 'dark'] as const).map((scheme) => (
                    <Card key={scheme}>
                      <CardHeader><CardTitle>{scheme === 'light' ? '浅色' : '深色'}颜色</CardTitle><CardDescription>仅接受 #RRGGBB 或 #RRGGBBAA，非法值预览和应用时会回退。</CardDescription></CardHeader>
                      <CardContent>
                        <FieldGroup>
                          {(Object.keys(colorLabels) as Array<keyof AppearanceColors>).map((key) => (
                            <ColorField
                              key={key}
                              id={`color-${scheme}-${key}`}
                              label={colorLabels[key]}
                              value={draft.colorSchemes[scheme][key]}
                              onChange={(value) => updateDraft((next) => { next.colorSchemes[scheme][key] = value })}
                              onPickerChange={(value) => updateDraftColor((next) => { next.colorSchemes[scheme][key] = value })}
                            />
                          ))}
                        </FieldGroup>
                      </CardContent>
                    </Card>
                  ))}
                  <Card>
                    <CardHeader><CardTitle>圆角</CardTitle><CardDescription>使用 0–999px 的受控长度。</CardDescription></CardHeader>
                    <CardContent><FieldGroup>{(Object.keys(radiusLabels) as Array<keyof AppearancePreset['radii']>).map((key) => <Field key={key}><FieldLabel htmlFor={`radius-${key}`}>{radiusLabels[key]}</FieldLabel><Input id={`radius-${key}`} value={draft.radii[key]} onChange={(event) => updateDraft((next) => { next.radii[key] = event.target.value })} /></Field>)}</FieldGroup></CardContent>
                  </Card>
                </div>
            </TabsContent>

            <TabsContent value="advanced">
                <div className="flex flex-col gap-4 py-2">
                  <Card>
                    <CardHeader><CardTitle>自定义 CSS</CardTitle><CardDescription>高级 CSS 使用 @scope 限制在应用 body 内，同时覆盖播放器和 Portal 弹窗；不执行 JavaScript。</CardDescription></CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <Field data-disabled={!riskConfirmed}>
                          <FieldLabel htmlFor="theme-custom-css">customCss</FieldLabel>
                          <Textarea id="theme-custom-css" className="min-h-48 font-mono" disabled={!riskConfirmed} value={draft.advanced.customCss} placeholder=".player-shell { /* 自定义样式 */ }" onChange={(event) => updateDraft((next) => { next.advanced.customCss = event.target.value })} />
                          <FieldDescription>可能破坏可读性、交互和升级兼容性；禁止 javascript:、expression() 等可执行式语法。</FieldDescription>
                        </Field>
                        {!riskConfirmed && draft.metadata.tier !== 'standard' ? <Button variant="outline" onClick={confirmRisk}>我了解风险，启用 CSS 预览</Button> : null}
                      </FieldGroup>
                    </CardContent>
                  </Card>
                </div>
            </TabsContent>

            <TabsContent value="experimental">
                <div className="flex flex-col gap-4 py-2">
                  <Card>
                    <CardHeader><CardTitle>布局覆盖</CardTitle><CardDescription>实验 CSS 不加 @scope，可使用更强选择器覆盖整个 WebView；仍不执行脚本。</CardDescription></CardHeader>
                    <CardContent>
                      <FieldGroup>
                        <Field data-disabled={!riskConfirmed || draft.metadata.tier !== 'experimental'}>
                          <FieldLabel htmlFor="theme-layout-css">layoutCss</FieldLabel>
                          <Textarea id="theme-layout-css" className="min-h-48 font-mono" disabled={!riskConfirmed || draft.metadata.tier !== 'experimental'} value={draft.experimental.layoutCss} placeholder=".player-stage { /* 实验布局覆盖 */ }" onChange={(event) => updateDraft((next) => { next.experimental.layoutCss = event.target.value })} />
                          <FieldDescription>资源模型允许 data:/blob:/http(s):/file:，实际加载受 WebView 与 CSP 限制。当前主题声明 {draft.experimental.resources.length} 个资源。</FieldDescription>
                        </Field>
                        <Field data-disabled={!riskConfirmed || draft.metadata.tier !== 'experimental'}>
                          <FieldLabel htmlFor="theme-resources">资源 JSON</FieldLabel>
                          <Textarea id="theme-resources" className="min-h-36 font-mono" disabled={!riskConfirmed || draft.metadata.tier !== 'experimental'} value={resourcesText} placeholder={'[{"id":"cover","kind":"image","source":"file:///..."}]'} onChange={(event) => updateResources(event.target.value)} />
                          <FieldDescription>最多 32 项；id 使用小写 slug，kind 为 font/image。应用仅暴露为 --theme-resource-&lt;id&gt;，不会执行文件内容。</FieldDescription>
                        </Field>
                        {!riskConfirmed && draft.metadata.tier === 'experimental' ? <Button variant="outline" onClick={confirmRisk}>我了解风险，启用实验预览</Button> : null}
                      </FieldGroup>
                    </CardContent>
                  </Card>
                </div>
            </TabsContent>
          </Tabs>
        </WorkspaceDialogContent>
      </Dialog>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>立即删除“{draft.name}”？</AlertDialogTitle>
            <AlertDialogDescription>该用户主题会立即从本地主题库移除，关闭或取消主题工作室不会撤销此操作。内置主题不会受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留主题</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>删除主题</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
