import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { TabsContent } from '@/components/ui/tabs'
import type { UpdateThemeDraft } from '../../hooks/useThemeDraft'
import type { AppearanceColors, AppearancePreset } from '../../model/appearanceTypes'
import { ColorField } from './ThemeFields'

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

type ThemeTokensTabProps = {
  draft: AppearancePreset
  updateDraft: UpdateThemeDraft
  updateDraftColor: UpdateThemeDraft
}

export function ThemeTokensTab({ draft, updateDraft, updateDraftColor }: ThemeTokensTabProps) {
  return (
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
          <CardContent>
            <FieldGroup>
              {(Object.keys(radiusLabels) as Array<keyof AppearancePreset['radii']>).map((key) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`radius-${key}`}>{radiusLabels[key]}</FieldLabel>
                  <Input id={`radius-${key}`} value={draft.radii[key]} onChange={(event) => updateDraft((next) => { next.radii[key] = event.target.value })} />
                </Field>
              ))}
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  )
}
