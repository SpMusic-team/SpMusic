import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppearance } from './useAppearance'
import { findBuiltinAppearance } from '../model/builtinAppearances'
import {
  cloneAppearance,
  deserializeAppearanceTheme,
  serializeAppearanceTheme,
} from '../model/appearanceThemeCodec'
import { defaultAppearance } from '../model/defaultAppearance'
import { hexColorPattern, inferThemeCapabilities } from '../model/themeDraft'
import type {
  AppearancePreset,
  AppearanceResource,
  AppearanceThemeMetadata,
  ColorSchemePreference,
} from '../model/appearanceTypes'

export type UpdateThemeDraft = (update: (next: AppearancePreset) => void) => void

export function useThemeDraft() {
  const appearanceContext = useAppearance()
  const colorFrameRef = useRef<number | null>(null)
  const pendingColorDraftRef = useRef<AppearancePreset | null>(null)
  const [draft, setDraft] = useState(() => cloneAppearance(appearanceContext.appearance))
  const draftRef = useRef(draft)
  const [draftColorSchemePreference, setDraftColorSchemePreference] = useState<ColorSchemePreference>(appearanceContext.colorSchemePreference)
  const [selectedThemeId, setSelectedThemeId] = useState(appearanceContext.activeThemeId)
  const [riskConfirmed, setRiskConfirmed] = useState(
    () => appearanceContext.appearance.metadata.tier === 'standard'
      || appearanceContext.appearance.metadata.riskAcknowledged,
  )
  const riskConfirmedRef = useRef(riskConfirmed)
  const [resourcesText, setResourcesText] = useState(() => JSON.stringify(appearanceContext.appearance.experimental.resources, null, 2))
  const [status, setStatus] = useState<string | null>(appearanceContext.storageWarning ?? null)

  const themeOptions = appearanceContext.themes.map((entry) => ({
    label: `${entry.appearance.name}${entry.builtin ? '（内置）' : ''}`,
    value: entry.appearance.id,
  }))
  if (!themeOptions.some((option) => option.value === selectedThemeId)) {
    themeOptions.push({ label: `${draft.name}（草稿）`, value: selectedThemeId })
  }

  const selectedTheme = appearanceContext.themes.find((entry) => entry.appearance.id === selectedThemeId)
  const selectedBuiltin = selectedTheme?.builtin ?? false
  const selectedPersistedUser = appearanceContext.themes.some((entry) => !entry.builtin && entry.appearance.id === selectedThemeId)

  function setRiskConfirmation(confirmed: boolean) {
    riskConfirmedRef.current = confirmed
    setRiskConfirmed(confirmed)
  }

  function safePreview(next: AppearancePreset, confirmed = riskConfirmedRef.current) {
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

  const updateDraftColor: UpdateThemeDraft = (update) => {
    const next = cloneAppearance(draftRef.current)
    update(next)
    next.metadata.capabilities = inferThemeCapabilities(next)
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

  const updateDraft: UpdateThemeDraft = (update) => {
    const next = cloneAppearance(draftRef.current)
    update(next)
    next.metadata.capabilities = inferThemeCapabilities(next)
    replaceDraft(next)
    safePreview(next)
  }

  useEffect(() => () => cancelScheduledColorCommit(), [])

  function chooseTheme(id: string) {
    const selected = appearanceContext.themes.find((entry) => entry.appearance.id === id)?.appearance
    if (!selected) return
    const next = cloneAppearance(selected)
    const confirmed = next.metadata.tier === 'standard' || next.metadata.riskAcknowledged
    setSelectedThemeId(id)
    replaceDraft(next)
    setResourcesText(JSON.stringify(next.experimental.resources, null, 2))
    setRiskConfirmation(confirmed)
    safePreview(next, confirmed)
    setStatus(null)
  }

  function changeColorSchemePreference(preference: ColorSchemePreference) {
    setDraftColorSchemePreference(preference)
    appearanceContext.previewColorSchemePreference(preference)
  }

  function changeTier(tier: AppearanceThemeMetadata['tier']) {
    const confirmed = tier === 'standard'
    setRiskConfirmation(confirmed)
    const next = cloneAppearance(draftRef.current)
    next.metadata.tier = tier
    next.metadata.riskAcknowledged = confirmed
    next.metadata.capabilities = inferThemeCapabilities(next)
    replaceDraft(next)
    safePreview(next, confirmed)
  }

  function confirmRisk() {
    setRiskConfirmation(true)
    const next = cloneAppearance(draftRef.current)
    next.metadata.riskAcknowledged = true
    next.metadata.capabilities = inferThemeCapabilities(next)
    replaceDraft(next)
    safePreview(next, true)
    setStatus('已确认高级主题风险；CSS 将实时作用于预览。')
  }

  function applyDraft() {
    const currentDraft = commitPendingColorDraft()
    if (currentDraft.metadata.tier !== 'standard' && !riskConfirmedRef.current) {
      setStatus('应用高级或实验主题前必须确认风险。')
      toast.error('请先确认主题风险')
      return false
    }

    const invalidOverlaySchemes = (['light', 'dark'] as const)
      .filter((scheme) => !hexColorPattern.test(currentDraft.colorSchemes[scheme].playerOverlay))
    if (invalidOverlaySchemes.length) {
      const schemeNames = invalidOverlaySchemes.map((scheme) => scheme === 'dark' ? '深色' : '浅色').join('、')
      const message = `${schemeNames}背景遮罩颜色无效，请使用 #RRGGBB 或 #RRGGBBAA。`
      setStatus(message)
      toast.error('请修正背景遮罩颜色')
      return false
    }

    const candidate = cloneAppearance(currentDraft)
    candidate.metadata.riskAcknowledged = candidate.metadata.tier === 'standard' ? false : riskConfirmedRef.current
    candidate.metadata.capabilities = inferThemeCapabilities(candidate)
    const validated = deserializeAppearanceTheme(serializeAppearanceTheme(candidate))
    if (!validated.ok) {
      setStatus(validated.error)
      toast.error(validated.error)
      return false
    }

    const sourceTheme = appearanceContext.themes.find((entry) => entry.appearance.id === selectedThemeId)?.appearance
    const unchangedBuiltin = selectedBuiltin && sourceTheme && JSON.stringify(sourceTheme) === JSON.stringify(validated.appearance)
    if (unchangedBuiltin) appearanceContext.selectTheme(selectedThemeId)
    else appearanceContext.saveAndApplyAppearance(validated.appearance)
    appearanceContext.setColorSchemePreference(draftColorSchemePreference)
    if (validated.warnings.length) toast.warning(`主题已应用，含 ${validated.warnings.length} 条回退提示`)
    else toast.success('主题已应用')
    return true
  }

  function cancelDraft() {
    cancelScheduledColorCommit()
    appearanceContext.cancelPreview()
  }

  function duplicateTheme() {
    const duplicate = cloneAppearance(draft)
    duplicate.id = `${draft.id.slice(0, 38).replace(/-+$/, '')}-copy-${Date.now()}`
    duplicate.name = `${draft.name} 副本`
    duplicate.metadata.author = '用户'
    replaceDraft(cloneAppearance(duplicate))
    setSelectedThemeId(duplicate.id)
    setResourcesText(JSON.stringify(duplicate.experimental.resources, null, 2))
    const confirmed = duplicate.metadata.tier === 'standard' || duplicate.metadata.riskAcknowledged
    setRiskConfirmation(confirmed)
    safePreview(duplicate, confirmed)
    setStatus('已创建主题副本草稿；点击“应用”后保存。')
    toast.success('已创建主题副本草稿')
  }

  function removeTheme() {
    const restoredBuiltin = findBuiltinAppearance(selectedThemeId)
    if (!appearanceContext.deleteAppearance(selectedThemeId)) return false
    const next = restoredBuiltin ?? defaultAppearance
    replaceDraft(cloneAppearance(next))
    setSelectedThemeId(next.id)
    setResourcesText(JSON.stringify(next.experimental.resources, null, 2))
    setRiskConfirmation(next.metadata.tier === 'standard' || next.metadata.riskAcknowledged)
    setStatus(restoredBuiltin ? '用户主题覆盖已删除，已恢复原内置主题。' : '用户主题已删除。')
    toast.success('已删除主题')
    return true
  }

  function resetDefaultTheme() {
    appearanceContext.resetDefault()
    replaceDraft(cloneAppearance(defaultAppearance))
    setSelectedThemeId(defaultAppearance.id)
    setResourcesText('[]')
    setRiskConfirmation(true)
    setStatus('已恢复默认主题。')
    toast.success('已恢复默认主题')
  }

  async function importThemeFile(file: File) {
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
    setRiskConfirmation(false)
    safePreview(result.appearance, !requiresConfirmation)
    const warningMessage = result.warnings.length ? `（${result.warnings.length} 个字段已回退）` : ''
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
      candidate.metadata.capabilities = inferThemeCapabilities(candidate)
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

  return {
    draft,
    draftColorSchemePreference,
    selectedThemeId,
    selectedBuiltin,
    selectedPersistedUser,
    themeOptions,
    riskConfirmed,
    resourcesText,
    status,
    resolvedColorScheme: appearanceContext.resolvedColorScheme,
    chooseTheme,
    changeColorSchemePreference,
    changeTier,
    confirmRisk,
    applyDraft,
    cancelDraft,
    duplicateTheme,
    removeTheme,
    resetDefaultTheme,
    importThemeFile,
    updateResources,
    exportDraft,
    updateDraft,
    updateDraftColor,
  }
}
