import {
  Cd16Regular,
  FastForward16Regular,
  Folder16Regular,
  MusicNote216Regular,
  Speaker216Regular,
  type FluentIcon,
} from '@fluentui/react-icons'
import { useState } from 'react'

import { PressFeedbackButton } from '@/features/player/components/PressFeedbackButton'
import type { AudioOutputInfo } from '@/features/player/services/audioCommands'
type PlaybackInfoButtonProps = {
  visible: boolean
  visualIsPlaying: boolean
  currentTrack?: {
    sourcePath?: string
    title: string
    artist: string
    album: string
  audioFormat?: {
      bitDepth: number | null
      sampleRateHz: number | null
      bitrateKbps: number | null
      codec: string | null
    }
  } | null
  audioOutputInfo?: AudioOutputInfo | null
}

type PlaybackInfoAudioFormat = {
  bitDepth: number | null
  sampleRateHz: number | null
  bitrateKbps: number | null
  codec: string | null
} | undefined

type PlaybackInfoVariant = {
  icon: FluentIcon | null
  text: string
}

function formatAudioFormat(audioFormat: PlaybackInfoAudioFormat): string {
  if (!audioFormat) return '音频格式'

  const parts: string[] = []
  if (audioFormat.bitDepth != null && audioFormat.bitDepth >= 24) {
    parts.push(`${audioFormat.bitDepth}BIT`)
  }
  if (audioFormat.sampleRateHz != null) {
    const sampleRateKhz = audioFormat.sampleRateHz / 1000
    parts.push(`${Number.isInteger(sampleRateKhz) ? sampleRateKhz : sampleRateKhz.toFixed(1)}KHZ`)
  }
  if (audioFormat.bitrateKbps != null && audioFormat.bitrateKbps > 0) {
    parts.push(`${audioFormat.bitrateKbps}KBPS`)
  }
  if (audioFormat.codec) parts.push(audioFormat.codec.toUpperCase())
  return parts.join(' ') || '音频格式'
}

function formatMusicDirectory(sourcePath: string | undefined): string {
  if (!sourcePath) return 'PRIMARY/MUSIC'
  const displayPath = sourcePath.startsWith('\\\\?\\UNC\\')
    ? `\\\\${sourcePath.slice(8)}`
    : sourcePath.startsWith('\\\\?\\')
      ? sourcePath.slice(4)
      : sourcePath
  const separatorIndex = Math.max(displayPath.lastIndexOf('/'), displayPath.lastIndexOf('\\'))
  if (separatorIndex < 0) return displayPath
  return displayPath.slice(0, separatorIndex) || displayPath.slice(0, 1)
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
    text: '当前歌曲',
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

export function PlaybackInfoButton({ visible, visualIsPlaying, currentTrack, audioOutputInfo }: PlaybackInfoButtonProps) {
  const [variantIndex, setVariantIndex] = useState(0)
  const currentVariant = playbackInfoVariants[variantIndex]
  const CurrentIcon = currentVariant.icon
  const currentText = variantIndex === 2
    ? [currentTrack?.title, currentTrack?.artist, currentTrack?.album]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .join(' - ') || currentVariant.text
    : currentVariant.text
  const audioFormatText = formatAudioFormat(currentTrack?.audioFormat)
  const musicDirectoryText = formatMusicDirectory(currentTrack?.sourcePath)
  const outputText = audioOutputInfo
    ? `${audioOutputInfo.method} ${audioOutputInfo.bitDepth} BIT ${audioOutputInfo.sampleRateHz / 1000} KHZ`
    : currentVariant.text

  const activateNextVariant = () => {
    setVariantIndex((currentIndex) => (currentIndex + 1) % playbackInfoVariants.length)
  }

  return (
    <PressFeedbackButton
      className="playback-info-button"
      type="button"
      layoutKey={variantIndex}
      data-visible={visible}
      data-playback-state={visualIsPlaying ? 'playing' : 'paused'}
      aria-hidden={!visible || undefined}
      aria-label={`当前播放信息：${variantIndex === 0 ? outputText : variantIndex === 3 ? audioFormatText : variantIndex === 4 ? musicDirectoryText : currentText}。点击切换播放信息。`}
      disabled={!visible}
      onPressStart={activateNextVariant}
    >
      <span className="playback-info-button-content">
        {CurrentIcon ? <CurrentIcon data-icon="inline-start" aria-hidden="true" /> : null}
        <span className="playback-info-button-text" aria-live="polite" aria-atomic="true">
          {variantIndex === 0 ? outputText : variantIndex === 3 ? audioFormatText : variantIndex === 4 ? musicDirectoryText : currentText}
        </span>
      </span>
    </PressFeedbackButton>
  )
}
