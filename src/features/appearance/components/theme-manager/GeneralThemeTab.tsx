import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { UpdateThemeDraft } from '../../hooks/useThemeDraft'
import type {
  AppearanceComponents,
  AppearancePreset,
  AppearanceThemeMetadata,
  AppearanceTypography,
  ColorSchemePreference,
  ResolvedColorScheme,
} from '../../model/appearanceTypes'
import { OptionField } from './ThemeFields'

const colorSchemeOptions = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
] as const
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

type GeneralThemeTabProps = {
  draft: AppearancePreset
  colorSchemePreference: ColorSchemePreference
  resolvedColorScheme: ResolvedColorScheme
  updateDraft: UpdateThemeDraft
  onColorSchemePreferenceChange: (preference: ColorSchemePreference) => void
  onTierChange: (tier: AppearanceThemeMetadata['tier']) => void
}

export function GeneralThemeTab({
  draft,
  colorSchemePreference,
  resolvedColorScheme,
  updateDraft,
  onColorSchemePreferenceChange,
  onTierChange,
}: GeneralThemeTabProps) {
  return (
    <TabsContent value="general">
      <div className="flex flex-col gap-4 py-2">
        <Card>
          <CardHeader><CardTitle>配色模式</CardTitle><CardDescription>可固定浅色或深色，也可实时跟随操作系统外观。</CardDescription></CardHeader>
          <CardContent>
            <FieldGroup>
              <OptionField
                id="color-scheme-preference"
                label="应用配色"
                value={colorSchemePreference}
                options={colorSchemeOptions}
                onChange={(value) => onColorSchemePreferenceChange(value as ColorSchemePreference)}
              />
              <FieldDescription>当前预览解析为{resolvedColorScheme === 'dark' ? '深色' : '浅色'}；系统外观变化会立即更新。</FieldDescription>
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
              <OptionField id="theme-tier" label="能力等级" value={draft.metadata.tier} options={tierOptions} onChange={(value) => onTierChange(value as AppearanceThemeMetadata['tier'])} />
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
  )
}
