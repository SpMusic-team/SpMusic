import { useState } from 'react'
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

export function SettingsDialog() {
  const settingsCopy = appCopy.settings
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [themeManagerOpen, setThemeManagerOpen] = useState(false)

  return (
    <Dialog open={settingsOpen} onOpenChange={(open) => {
      setSettingsOpen(open)
      if (!open) setThemeManagerOpen(false)
    }}>
      <Tooltip>
        <TooltipTrigger render={<DialogTrigger render={<Button className="window-settings-trigger" aria-label={appCopy.controls.settings} size="icon" type="button" variant="ghost" />} />}>
          <SettingsIcon />
        </TooltipTrigger>
        <TooltipContent>{appCopy.controls.settings}</TooltipContent>
      </Tooltip>
      <DialogContent
        className="player-settings-dialog"
        data-theme-manager-open={themeManagerOpen}
        overlayClassName={themeManagerOpen ? 'player-settings-overlay player-settings-overlay-hidden' : 'player-settings-overlay'}
      >
        <DialogHeader>
          <DialogTitle>{settingsCopy.title}</DialogTitle>
          <DialogDescription>{settingsCopy.description}</DialogDescription>
        </DialogHeader>

        <FieldGroup className="player-settings-group">
          <Field className="player-settings-row player-settings-theme-row" orientation="horizontal">
            <FieldContent>
              <FieldLabel>{settingsCopy.theme.title}</FieldLabel>
              <FieldDescription>{settingsCopy.theme.description}</FieldDescription>
            </FieldContent>
            <ThemeManager onOpenChange={setThemeManagerOpen} />
          </Field>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  )
}
