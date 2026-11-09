import { Button } from '@/components/ui/button'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { UpdateThemeDraft } from '../../hooks/useThemeDraft'
import type { AppearancePreset } from '../../model/appearanceTypes'

type ExperimentalThemeTabProps = {
  draft: AppearancePreset
  resourcesText: string
  riskConfirmed: boolean
  updateDraft: UpdateThemeDraft
  onResourcesChange: (value: string) => void
  onConfirmRisk: () => void
}

export function ExperimentalThemeTab({
  draft,
  resourcesText,
  riskConfirmed,
  updateDraft,
  onResourcesChange,
  onConfirmRisk,
}: ExperimentalThemeTabProps) {
  const disabled = !riskConfirmed || draft.metadata.tier !== 'experimental'

  return (
    <TabsContent value="experimental">
      <div className="py-2">
        <Accordion className="rounded-lg border px-4">
          <AccordionItem value="layout-overrides">
            <AccordionTrigger>布局覆盖</AccordionTrigger>
            <AccordionContent>
              <p className="text-muted-foreground">实验 CSS 不加 @scope，可使用更强选择器覆盖整个 WebView；仍不执行脚本。</p>
            <FieldGroup>
              <Field data-disabled={disabled}>
                <FieldLabel htmlFor="theme-layout-css">layoutCss</FieldLabel>
                <Textarea id="theme-layout-css" className="min-h-48 font-mono" disabled={disabled} value={draft.experimental.layoutCss} placeholder=".player-stage { /* 实验布局覆盖 */ }" onChange={(event) => updateDraft((next) => { next.experimental.layoutCss = event.target.value })} />
                <FieldDescription>资源模型允许 data:/blob:/http(s):/file:，实际加载受 WebView 与 CSP 限制。当前主题声明 {draft.experimental.resources.length} 个资源。</FieldDescription>
              </Field>
              <Field data-disabled={disabled}>
                <FieldLabel htmlFor="theme-resources">资源 JSON</FieldLabel>
                <Textarea id="theme-resources" className="min-h-36 font-mono" disabled={disabled} value={resourcesText} placeholder={'[{"id":"cover","kind":"image","source":"file:///..."}]'} onChange={(event) => onResourcesChange(event.target.value)} />
                <FieldDescription>最大 32 项；id 使用小写 slug，kind 为 font/image。应用仅暴露为 --theme-resource-&lt;id&gt;，不会执行文件内容。</FieldDescription>
              </Field>
              {!riskConfirmed && draft.metadata.tier === 'experimental' ? <Button variant="outline" onClick={onConfirmRisk}>我了解风险，启用实验预览</Button> : null}
            </FieldGroup>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </TabsContent>
  )
}
