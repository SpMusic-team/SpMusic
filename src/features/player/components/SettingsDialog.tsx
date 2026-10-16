import { lazy, Suspense, useState } from 'react'
import { PaletteIcon, SettingsIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { IconButton } from '@/features/player/components/IconButton'
import { appCopy } from '@/features/player/model/playerCopy'
import type { PlaylistControllerMode } from '@/features/player/model/playlistControllerMode'
import { GlobalShortcutSettings } from '@/features/shortcuts/components/GlobalShortcutSettings'

const ThemeManager = lazy(() => import('@/features/appearance/components/ThemeManager').then((module) => ({
  default: module.ThemeManager,
})))

const DevAudioSettingsField = import.meta.env.DEV
  ? lazy(() => import('@/features/player/components/DevAudioSettingsField').then((module) => ({
      default: module.DevAudioSettingsField,
    })))
  : null

type SettingsDialogProps = {
  controllerMode?: PlaylistControllerMode
  onControllerModeChange?: (mode: PlaylistControllerMode) => void
  debugToolsEnabled?: boolean
  debugToolsOpen?: boolean
  onDebugToolsOpenChange?: (open: boolean) => void
}

export function SettingsDialog({
  controllerMode = 'movable',
  onControllerModeChange,
  debugToolsEnabled = false,
  debugToolsOpen = false,
  onDebugToolsOpenChange,
}: SettingsDialogProps) {
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
          <Field className="player-settings-row" orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="playlist-controller-mode">{settingsCopy.controller.title}</FieldLabel>
              <FieldDescription>{settingsCopy.controller.description}</FieldDescription>
            </FieldContent>
            <Select
              items={[
                { label: settingsCopy.controller.movable, value: 'movable' },
                { label: settingsCopy.controller.fixed, value: 'fixed' },
              ]}
              value={controllerMode}
              disabled={!onControllerModeChange}
              onValueChange={(value) => {
                if (value === 'fixed' || value === 'movable') onControllerModeChange?.(value)
              }}
            >
              <SelectTrigger id="playlist-controller-mode"><SelectValue /></SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value="movable">{settingsCopy.controller.movable}</SelectItem>
                  <SelectItem value="fixed">{settingsCopy.controller.fixed}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {DevAudioSettingsField && debugToolsEnabled ? (
            <Suspense fallback={null}>
              <DevAudioSettingsField
                open={debugToolsOpen}
                onOpenChange={(open) => {
                  onDebugToolsOpenChange?.(open)
                  if (open) setSettingsOpen(false)
                }}
              />
            </Suspense>
          ) : null}
          <Field className="player-settings-row player-settings-theme-row" orientation="horizontal">
            <FieldContent>
              <FieldLabel>{settingsCopy.theme.title}</FieldLabel>
              <FieldDescription>{settingsCopy.theme.description}</FieldDescription>
            </FieldContent>
            <IconButton
              icon={PaletteIcon}
              label="主题管理"
              onClick={() => setThemeManagerOpen(true)}
            />
          </Field>
          {settingsOpen && !themeManagerOpen ? <GlobalShortcutSettings /> : null}
        </FieldGroup>
      </DialogContent>
      {themeManagerOpen ? (
        <Suspense fallback={null}>
          <ThemeManager open onOpenChange={setThemeManagerOpen} />
        </Suspense>
      ) : null}
    </Dialog>
  )
}
