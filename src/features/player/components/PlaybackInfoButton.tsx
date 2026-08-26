import { Button } from '@/components/ui/button'
import { useSystemIcons } from '@/features/appearance/hooks/useAppearance'
import { appCopy } from '@/features/player/model/playerCopy'

type PlaybackInfoButtonProps = {
  visible: boolean
}

export function PlaybackInfoButton({ visible }: PlaybackInfoButtonProps) {
  const systemIcons = useSystemIcons()
  const OutputIcon = systemIcons.volume

  return (
    <Button
      className="playback-info-button"
      type="button"
      variant="secondary"
      data-visible={visible}
      aria-hidden={!visible || undefined}
      aria-label={appCopy.playbackInfo.label}
      disabled={!visible}
    >
      <span className="playback-info-button-content">
        <OutputIcon data-icon="inline-start" aria-hidden="true" />
        <span className="playback-info-button-text">{appCopy.playbackInfo.output}</span>
      </span>
    </Button>
  )
}
