import { Field, FieldContent, FieldDescription } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type DevAudioSettingsFieldProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DevAudioSettingsField({ open, onOpenChange }: DevAudioSettingsFieldProps) {
  return (
    <Field className="player-settings-row" orientation="horizontal">
      <FieldContent>
        <Label htmlFor="temporary-control-bar">开发音频控制台</Label>
        <FieldDescription>仅在开发环境显示，用于检查真实音频后端状态。</FieldDescription>
      </FieldContent>
      <Switch
        id="temporary-control-bar"
        aria-label="开发音频控制台"
        checked={open}
        onCheckedChange={onOpenChange}
      />
    </Field>
  )
}
