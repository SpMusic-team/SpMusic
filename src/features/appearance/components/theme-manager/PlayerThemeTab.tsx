import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>歌词与音量</CardTitle>
            <CardDescription>控制播放器中的歌词可读性与音量面板显示，不改变真实播放状态。</CardDescription>
          </CardHeader>
          <CardContent>
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
              <OptionField id="player-volume-percent" label="音量百分比显示" description="隐藏时只移除数值文本；滑块读屏数值与真实音量控制保持不变。" value={String(draft.player.showVolumePercent)} options={booleanOptions} onChange={(value) => updateDraft((next) => { next.player.showVolumePercent = value === 'true' })} />
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  )
}
