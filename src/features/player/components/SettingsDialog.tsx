import { SettingsIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ThemeManager } from '@/features/appearance/components/ThemeManager'
import { appCopy } from '@/features/player/model/playerCopy'

type SettingsDialogProps = {
  temporaryControlBarEnabled: boolean
  onTemporaryControlBarEnabledChange: (enabled: boolean) => void
}

export function SettingsDialog({
  temporaryControlBarEnabled,
  onTemporaryControlBarEnabledChange,
}: SettingsDialogProps) {
  const settingsCopy = appCopy.settings

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger render={<DialogTrigger render={<Button aria-label={appCopy.controls.settings} size="icon" type="button" variant="ghost" />} />}>
          <SettingsIcon />
        </TooltipTrigger>
        <TooltipContent>{appCopy.controls.settings}</TooltipContent>
      </Tooltip>
      <DialogContent className="player-settings-dialog">
        <DialogHeader>
          <DialogTitle>{settingsCopy.title}</DialogTitle>
          <DialogDescription>{settingsCopy.description}</DialogDescription>
        </DialogHeader>

        <FieldGroup className="player-settings-group">
          <Field className="player-settings-row" orientation="horizontal">
            <FieldContent>
              <FieldLabel>{settingsCopy.temporaryControlBar.title}</FieldLabel>
              <FieldDescription>{settingsCopy.temporaryControlBar.description}</FieldDescription>
            </FieldContent>
            <button
              type="button"
              className="player-settings-toggle"
              aria-pressed={temporaryControlBarEnabled}
              onClick={() => onTemporaryControlBarEnabledChange(!temporaryControlBarEnabled)}
            >
              <span aria-hidden="true" />
              {temporaryControlBarEnabled ? settingsCopy.on : settingsCopy.off}
            </button>
          </Field>

          <Field className="player-settings-row player-settings-theme-row" orientation="horizontal">
            <FieldContent>
              <FieldLabel>{settingsCopy.theme.title}</FieldLabel>
              <FieldDescription>{settingsCopy.theme.description}</FieldDescription>
            </FieldContent>
            <ThemeManager />
          </Field>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  )
}
