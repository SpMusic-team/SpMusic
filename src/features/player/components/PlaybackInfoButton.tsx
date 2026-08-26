import {
  Cd16Regular,
  FastForward16Regular,
  Folder16Regular,
  MusicNote216Regular,
  Speaker216Regular,
  type FluentIcon,
} from '@fluentui/react-icons'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

type PlaybackInfoButtonProps = {
  visible: boolean
}

type PlaybackInfoVariant = {
  icon: FluentIcon | null
  text: string
}

const playbackInfoVariants: readonly PlaybackInfoVariant[] = [
  {
    icon: Speaker216Regular,
    text: 'OPENSL ES OUTPUT 16 BIT 48 KHZ',
  },
  {
    icon: Cd16Regular,
    text: '艺术家专辑 - 1/3',
  },
  {
    icon: FastForward16Regular,
    text: "ETHER STRIKE(‘DIVINE MERCY’ EXTENDED ) - AKIRA COMPLEX",
  },
  {
    icon: null,
    text: '44.1KHZ 320KBPS MP3',
  },
  {
    icon: Folder16Regular,
    text: 'PRIMARY/MUSIC',
  },
  {
    icon: MusicNote216Regular,
    text: '所有歌曲 - 418/1784',
  },
]

export function PlaybackInfoButton({ visible }: PlaybackInfoButtonProps) {
  const [variantIndex, setVariantIndex] = useState(0)
  const currentVariant = playbackInfoVariants[variantIndex]
  const CurrentIcon = currentVariant.icon

  const showNextVariant = () => {
    setVariantIndex((currentIndex) => (currentIndex + 1) % playbackInfoVariants.length)
  }

  return (
    <Button
      className="playback-info-button"
      type="button"
      variant="secondary"
      data-visible={visible}
      aria-hidden={!visible || undefined}
      aria-label={`当前播放信息：${currentVariant.text}。点击切换播放信息。`}
      disabled={!visible}
      onClick={showNextVariant}
    >
      <span className="playback-info-button-content">
        {CurrentIcon ? <CurrentIcon data-icon="inline-start" aria-hidden="true" /> : null}
        <span className="playback-info-button-text" aria-live="polite" aria-atomic="true">
          {currentVariant.text}
        </span>
      </span>
    </Button>
  )
}
