import { Button } from '@/components/ui/button'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { UpdateThemeDraft } from '../../hooks/useThemeDraft'
import type { AppearancePreset } from '../../model/appearanceTypes'

type AdvancedThemeTabProps = {
  draft: AppearancePreset
  riskConfirmed: boolean
  updateDraft: UpdateThemeDraft
  onConfirmRisk: () => void
}

export function AdvancedThemeTab({ draft, riskConfirmed, updateDraft, onConfirmRisk }: AdvancedThemeTabProps) {
  return (
    <TabsContent value="advanced">
      <div className="py-2">
        <Accordion className="rounded-lg border px-4">
          <AccordionItem value="custom-css">
            <AccordionTrigger>自定义 CSS</AccordionTrigger>
            <AccordionContent>
              <p className="text-muted-foreground">高级 CSS 使用 @scope 限制在应用 body 内，同时覆盖播放器和 Portal 弹窗；不执行 JavaScript。</p>
            <FieldGroup>
              <Field data-disabled={!riskConfirmed}>
                <FieldLabel htmlFor="theme-custom-css">customCss</FieldLabel>
                <Textarea id="theme-custom-css" className="min-h-48 font-mono" disabled={!riskConfirmed} value={draft.advanced.customCss} placeholder=".player-shell { /* 自定义样式 */ }" onChange={(event) => updateDraft((next) => { next.advanced.customCss = event.target.value })} />
                <FieldDescription>可能破坏可读性、交互和升级兼容性；禁止 javascript:、expression() 等可执行式语法。</FieldDescription>
              </Field>
              {!riskConfirmed && draft.metadata.tier !== 'standard' ? <Button variant="outline" onClick={onConfirmRisk}>我了解风险，启用 CSS 预览</Button> : null}
            </FieldGroup>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </TabsContent>
  )
}
