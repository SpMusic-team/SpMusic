import { toast } from 'sonner'
import type { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'
import type { ShuffleMode } from '@/features/player/model/playbackModes'
import type { SystemIcon } from '@/icons/systemIcons'

export type PlaybackModePresentation = {
  icon: SystemIcon
  label: string
  pressed: boolean
}

const playbackModeToastId = 'player-playback-mode'

export function getShuffleModePresentation(
  mode: ShuffleMode,
  systemIcons: ReturnType<typeof useSystemIcons>,
): PlaybackModePresentation {
  const presentations: Record<ShuffleMode, PlaybackModePresentation> = {
    none: { icon: systemIcons.shuffleOff, label: appCopy.controls.shuffleOff, pressed: false },
    'shuffle-all': { icon: systemIcons.shuffle, label: appCopy.controls.shuffle, pressed: true },
    'shuffle-category-order': { icon: systemIcons.shuffleCategoryOrder, label: appCopy.controls.shuffleCategoryOrder, pressed: true },
    'shuffle-category-random': { icon: systemIcons.shuffleCategoryRandom, label: appCopy.controls.shuffleCategoryRandom, pressed: true },
  }
  return presentations[mode]
}

export function showPlaybackModeToast({ icon: ModeIcon, label }: PlaybackModePresentation) {
  toast.custom(
    () => (
      <div className="playback-mode-toast">
        <ModeIcon aria-hidden="true" />
        <span>{label}</span>
      </div>
    ),
    {
      id: playbackModeToastId,
      className: 'playback-mode-toast-shell',
      duration: 2500,
      position: 'top-center',
      unstyled: true,
    },
  )
}
