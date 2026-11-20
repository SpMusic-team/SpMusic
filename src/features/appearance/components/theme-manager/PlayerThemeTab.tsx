import { useEffect, useRef } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { FieldGroup } from '@/components/ui/field'
import { TabsContent } from '@/components/ui/tabs'
import type { UpdateThemeDraft } from '../../hooks/useThemeDraft'
import type { AppearancePlayer, AppearancePreset, ResolvedColorScheme } from '../../model/appearanceTypes'
import { ColorField, OptionField, SliderField } from './ThemeFields'

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
const controllerMaterialOptions = [
  { label: '跟随全局', value: 'inherit' },
  { label: '玻璃', value: 'glass' },
  { label: '实色', value: 'solid' },
  { label: '扁平', value: 'flat' },
] as const
const controllerDensityOptions = [
  { label: '紧凑', value: 'compact' },
  { label: '标准', value: 'standard' },
  { label: '舒适', value: 'comfortable' },
] as const
const primaryButtonStyleOptions = [
  { label: '填充', value: 'filled' },
  { label: '柔和', value: 'soft' },
  { label: '描边', value: 'outline' },
] as const
const auxiliaryButtonStyleOptions = [
  { label: '分级', value: 'tiered' },
  { label: '极简', value: 'minimal' },
  { label: '柔和', value: 'soft' },
  { label: '描边', value: 'outline' },
] as const

function colorOpacity(value: string) {
  return /^#[0-9a-f]{8}$/i.test(value) ? Math.round(Number.parseInt(value.slice(7), 16) / 255 * 100) : 100
}

function colorWithOpacity(value: string, opacity: number) {
  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) return value
  const rgb = value.slice(0, 7)
  if (opacity >= 100) return rgb
  return `${rgb}${Math.round(opacity / 100 * 255).toString(16).padStart(2, '0')}`
}

function backgroundRgbWithPreservedAlpha(value: string, alpha: string) {
  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) return value
  return `${value.slice(0, 7)}${alpha}`
}

type PlayerDockColorFieldProps = {
  scheme: 'light' | 'dark'
  value: string
  onChange: (value: string) => void
  onPickerChange: (value: string) => void
}

function PlayerDockColorField({ scheme, value, onChange, onPickerChange }: PlayerDockColorFieldProps) {
  const alphaRef = useRef(/^#[0-9a-f]{8}$/i.test(value) ? value.slice(7) : '')
  useEffect(() => {
    if (/^#[0-9a-f]{8}$/i.test(value)) alphaRef.current = value.slice(7)
    else if (/^#[0-9a-f]{6}$/i.test(value)) alphaRef.current = ''
  }, [value])
  const preserveAlpha = (next: string) => backgroundRgbWithPreservedAlpha(next, alphaRef.current)

  return (
    <ColorField
      id={`player-controls-background-${scheme}`}
      label={`背景色（${scheme === 'light' ? '浅色' : '深色'}）`}
      description="与透明度共同编辑 playerDock RGBA token；取色或输入颜色时会保留当前透明度。"
      value={value}
      onChange={(next) => onChange(preserveAlpha(next))}
      onPickerChange={(next) => onPickerChange(preserveAlpha(next))}
    />
  )
}

type PlayerThemeTabProps = {
  draft: AppearancePreset
  resolvedColorScheme: ResolvedColorScheme
  updateDraft: UpdateThemeDraft
  updateDraftColor: UpdateThemeDraft
}

export function PlayerThemeTab({ draft, resolvedColorScheme, updateDraft, updateDraftColor }: PlayerThemeTabProps) {
  const backgroundBlurDisabled = draft.player.backgroundEffect !== 'cover-ambient'
  const backgroundMaskDisabled = draft.player.backgroundEffect === 'off'
  const backgroundVisualDisabled = draft.player.backgroundEffect === 'off'
  const playerOverlayColor = draft.colorSchemes[resolvedColorScheme].playerOverlay
  const playerLyricsColor = draft.colorSchemes[resolvedColorScheme].playerLyrics

  return (
    <TabsContent value="player">
      <div className="py-2">
        <Accordion className="rounded-lg border px-4">
          <AccordionItem value="background-cover">
            <AccordionTrigger>背景与封面</AccordionTrigger>
            <AccordionContent>
              <p className="text-muted-foreground">调整播放器舞台的氛围层与封面外观，不会改动主题颜色 token。</p>
            <FieldGroup>
              <OptionField
                id="player-background-effect"
                label="播放器背景效果"
                description="封面氛围使用当前专辑图；主题渐变使用主题色过渡，纯色使用柔和强调色，关闭则仅保留应用背景。"
                value={draft.player.backgroundEffect}
                options={playerBackgroundOptions}
                onChange={(value) => updateDraft((next) => { next.player.backgroundEffect = value as AppearancePlayer['backgroundEffect'] })}
              />
              <SliderField id="player-background-blur" label="背景模糊强度" description={backgroundBlurDisabled ? '仅“封面氛围”使用封面背景并支持模糊；当前背景无需模糊。' : '连续调节 0–100%；只作用于封面氛围背景。'} disabled={backgroundBlurDisabled} value={draft.player.backgroundBlur} onChange={(value) => updateDraft((next) => { next.player.backgroundBlur = value })} />
              <SliderField id="player-background-brightness" label="背景亮度" description={backgroundVisualDisabled ? '背景效果已关闭，因此亮度不会渲染；切换到其他背景后可调整。' : '连续调节 0–200%；100% 保持原始亮度。'} disabled={backgroundVisualDisabled} max={200} value={draft.player.backgroundBrightness} onChange={(value) => updateDraft((next) => { next.player.backgroundBrightness = value })} />
              <SliderField id="player-background-saturation" label="背景饱和度" description={backgroundVisualDisabled ? '背景效果已关闭，因此饱和度不会渲染；切换到其他背景后可调整。' : '连续调节 0–200%；0% 为灰度，100% 为原始饱和度。'} disabled={backgroundVisualDisabled} max={200} value={draft.player.backgroundSaturation} onChange={(value) => updateDraft((next) => { next.player.backgroundSaturation = value })} />
              <SliderField id="player-background-mask-opacity" label="背景遮罩强度" description={backgroundMaskDisabled ? '背景效果已关闭，因此遮罩不会渲染；切换到其他背景后可调整。' : '连续调节 0–100%；颜色与强度相互独立。'} disabled={backgroundMaskDisabled} value={draft.player.backgroundMaskOpacity} onChange={(value) => updateDraft((next) => { next.player.backgroundMaskOpacity = value })} />
              <SliderField id="player-background-vignette" label="暗角强度" description={backgroundVisualDisabled ? '背景效果已关闭，因此暗角不会渲染；切换到其他背景后可调整。' : '连续调节 0–100%；只压暗背景边缘，不影响封面、歌词和控件。'} disabled={backgroundVisualDisabled} value={draft.player.backgroundVignette} onChange={(value) => updateDraft((next) => { next.player.backgroundVignette = value })} />
              <ColorField
                id="player-background-mask-color"
                label={`背景遮罩颜色（当前${resolvedColorScheme === 'dark' ? '深色' : '浅色'}）`}
                description="与 Tokens 使用同一字段；接受 #RRGGBB 或 #RRGGBBAA。切换应用配色后可分别设置浅色和深色。"
                value={playerOverlayColor}
                onChange={(value) => updateDraft((next) => { next.colorSchemes[resolvedColorScheme].playerOverlay = value })}
                onPickerChange={(value) => updateDraftColor((next) => { next.colorSchemes[resolvedColorScheme].playerOverlay = value })}
              />
              <SliderField id="player-cover-radius" label="封面圆角" description="连续调节 0–100%；0% 为直角，响应式布局会按比例缩放。" value={draft.player.coverRadius} onChange={(value) => updateDraft((next) => { next.player.coverRadius = value })} />
              <SliderField id="player-cover-shadow" label="封面阴影" description="连续调节 0–100%；0% 完全关闭，数值越大投影越明显。" value={draft.player.coverShadow} onChange={(value) => updateDraft((next) => { next.player.coverShadow = value })} />
            </FieldGroup>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="lyrics-volume">
            <AccordionTrigger>歌词</AccordionTrigger>
            <AccordionContent>
              <p className="text-muted-foreground">控制播放器中的歌词可读性，不改变真实播放状态。</p>
            <FieldGroup>
              <SliderField id="player-lyrics-font-scale" label="歌词字号" description="按 75–150% 同步缩放原文、翻译、当前歌词与稳定行高。" min={75} max={150} step={5} value={draft.player.lyricsFontScale * 100} onChange={(value) => updateDraft((next) => { next.player.lyricsFontScale = value / 100 })} />
              <ColorField
                id="player-lyrics-color"
                label={`歌词颜色（当前${resolvedColorScheme === 'dark' ? '深色' : '浅色'}）`}
                description="控制非当前、过去、未来及翻译歌词的基础色；当前歌词强调颜色仍由强调方式独立控制。"
                value={playerLyricsColor}
                onChange={(value) => updateDraft((next) => { next.colorSchemes[resolvedColorScheme].playerLyrics = value })}
                onPickerChange={(value) => updateDraftColor((next) => { next.colorSchemes[resolvedColorScheme].playerLyrics = value })}
              />
              <OptionField id="player-active-lyric-emphasis" label="当前歌词强调方式" description="组合会同时采用当前默认界面的加粗与放大效果。" value={draft.player.activeLyricEmphasis} options={activeLyricEmphasisOptions} onChange={(value) => updateDraft((next) => { next.player.activeLyricEmphasis = value as AppearancePlayer['activeLyricEmphasis'] })} />
              <SliderField id="player-lyrics-tight-threshold" label="紧密判定阈值" description="相邻两条歌词的开始时间差 delta 小于此值时使用紧密间距；等于阈值时使用普通间距。" min={0} max={30} step={0.5} unit="秒" value={draft.player.lyricsTightThresholdSeconds} onChange={(value) => updateDraft((next) => { next.player.lyricsTightThresholdSeconds = value })} />
              <SliderField id="player-lyrics-tight-spacing" label="紧密歌词间距" description="设置时间差小于阈值的相邻歌词净空；0 表示不添加行后净空。" min={0} max={Math.min(48, draft.player.lyricsNormalSpacing)} step={1} unit="布局单位" value={draft.player.lyricsTightSpacing} onChange={(value) => updateDraft((next) => { next.player.lyricsTightSpacing = value })} />
              <SliderField id="player-lyrics-normal-spacing" label="普通/长间隔歌词间距" description="设置时间差达到阈值的相邻歌词净空，且不会小于紧密歌词间距。" min={draft.player.lyricsTightSpacing} max={120} step={1} unit="布局单位" value={draft.player.lyricsNormalSpacing} onChange={(value) => updateDraft((next) => { next.player.lyricsNormalSpacing = value })} />
            </FieldGroup>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="playback-controller">
            <AccordionTrigger>播放控制器</AccordionTrigger>
            <AccordionContent>
              <p className="text-muted-foreground">调整控制器的视觉样式与信息显示；不会改变播放、进度或音量的行为。</p>
              <FieldGroup>
                <OptionField id="player-controls-material" label="材质" description="跟随全局会使用组件表面的玻璃、实色或扁平设置。" value={draft.player.controls.material} options={controllerMaterialOptions} onChange={(value) => updateDraft((next) => { next.player.controls.material = value as AppearancePlayer['controls']['material'] })} />
                {(['light', 'dark'] as const).map((scheme) => (
                  <PlayerDockColorField
                    key={`player-controls-background-${scheme}`}
                    scheme={scheme}
                    value={draft.colorSchemes[scheme].playerDock}
                    onChange={(value) => updateDraft((next) => { next.colorSchemes[scheme].playerDock = value })}
                    onPickerChange={(value) => updateDraftColor((next) => { next.colorSchemes[scheme].playerDock = value })}
                  />
                ))}
                {(['light', 'dark'] as const).map((scheme) => (
                  <SliderField
                    key={`player-controls-opacity-${scheme}`}
                    id={`player-controls-opacity-${scheme}`}
                    label={`背景透明度（${scheme === 'light' ? '浅色' : '深色'}）`}
                    description="#RRGGBB 视为 100%；滑块只修改 playerDock 的 AA，不叠加 CSS opacity。"
                    value={colorOpacity(draft.colorSchemes[scheme].playerDock)}
                    onChange={(value) => updateDraft((next) => { next.colorSchemes[scheme].playerDock = colorWithOpacity(next.colorSchemes[scheme].playerDock, value) })}
                  />
                ))}
                <SliderField id="player-controls-radius" label="圆角" description="连续调节 0–100%；50% 与默认控制器圆角一致。" value={draft.player.controls.radius} onChange={(value) => updateDraft((next) => { next.player.controls.radius = value })} />
                <SliderField id="player-controls-shadow" label="阴影" description="连续调节 0–100%；50% 与默认控制器阴影一致，材质不会覆盖此设置。" value={draft.player.controls.shadow} onChange={(value) => updateDraft((next) => { next.player.controls.shadow = value })} />
                <OptionField id="player-controls-density" label="密度" description="只调整控制器内部留白、间距与非播放按钮的视觉密度。" value={draft.player.controls.density} options={controllerDensityOptions} onChange={(value) => updateDraft((next) => { next.player.controls.density = value as AppearancePlayer['controls']['density'] })} />
                <OptionField id="player-primary-button-style" label="播放按钮样式" value={draft.player.controls.primaryButton.style} options={primaryButtonStyleOptions} onChange={(value) => updateDraft((next) => { next.player.controls.primaryButton.style = value as AppearancePlayer['controls']['primaryButton']['style'] })} />
                <SliderField id="player-primary-button-size" label="播放按钮尺寸" description="按各播放器布局的基准尺寸缩放，并限制在控制器内部。" min={75} max={130} step={5} value={draft.player.controls.primaryButton.sizeScale} onChange={(value) => updateDraft((next) => { next.player.controls.primaryButton.sizeScale = value })} />
                <OptionField id="player-auxiliary-button-style" label="辅助按钮样式" description="分级会精确保留当前上一首、下一首描边，其余按钮极简的样式。" value={draft.player.controls.auxiliaryButtons.style} options={auxiliaryButtonStyleOptions} onChange={(value) => updateDraft((next) => { next.player.controls.auxiliaryButtons.style = value as AppearancePlayer['controls']['auxiliaryButtons']['style'] })} />
                {(['light', 'dark'] as const).flatMap((scheme) => ([
                  <ColorField key={`player-progress-played-${scheme}`} id={`player-progress-played-${scheme}`} label={`进度已播放颜色（${scheme === 'light' ? '浅色' : '深色'}）`} value={draft.colorSchemes[scheme].playerProgressPlayed} onChange={(value) => updateDraft((next) => { next.colorSchemes[scheme].playerProgressPlayed = value })} onPickerChange={(value) => updateDraftColor((next) => { next.colorSchemes[scheme].playerProgressPlayed = value })} />,
                  <ColorField key={`player-progress-unplayed-${scheme}`} id={`player-progress-unplayed-${scheme}`} label={`进度未播放颜色（${scheme === 'light' ? '浅色' : '深色'}）`} value={draft.colorSchemes[scheme].playerProgressUnplayed} onChange={(value) => updateDraft((next) => { next.colorSchemes[scheme].playerProgressUnplayed = value })} onPickerChange={(value) => updateDraftColor((next) => { next.colorSchemes[scheme].playerProgressUnplayed = value })} />,
                ]))}
                <SliderField id="player-progress-track-thickness" label="进度轨道厚度" description="设置 2–12 个布局单位的轨道厚度。" min={2} max={12} step={1} unit="布局单位" value={draft.player.controls.progress.trackThickness} onChange={(value) => updateDraft((next) => { next.player.controls.progress.trackThickness = value })} />
                <SliderField id="player-progress-thumb-size" label="进度拇指尺寸" description="设置 12–36 个布局单位的拖动拇指尺寸。" min={12} max={36} step={1} unit="布局单位" value={draft.player.controls.progress.thumbSize} onChange={(value) => updateDraft((next) => { next.player.controls.progress.thumbSize = value })} />
                <OptionField id="player-controls-time-labels" label="显示时间" description="隐藏时只移除两个时间文本，并让进度轨道占满该行。" value={String(draft.player.controls.visibility.timeLabels)} options={booleanOptions} onChange={(value) => updateDraft((next) => { next.player.controls.visibility.timeLabels = value === 'true' })} />
                <OptionField id="player-volume-percent" label="显示音量百分比" description="隐藏时只移除数值文本；滑块读屏数值与真实音量控制保持不变。" value={String(draft.player.controls.visibility.volumePercent)} options={booleanOptions} onChange={(value) => updateDraft((next) => { next.player.controls.visibility.volumePercent = value === 'true' })} />
              </FieldGroup>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </TabsContent>
  )
}
