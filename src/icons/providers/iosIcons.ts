import { createElement, type ComponentType, type SVGProps } from 'react'
import { Checklist, Chevron, Loop, Play, Speaker, XMark } from 'react-ios-icons'
import type { SystemIcon, SystemIconProvider } from '@/icons/types'

type AnyIconProps = Record<string, unknown>

function libraryIcon(Icon: ComponentType<AnyIconProps>, extraProps: AnyIconProps = {}): SystemIcon {
  return function IosLibraryIcon(props) {
    return createElement(Icon, { ...props, ...extraProps })
  }
}

function pathIcon(paths: Array<Record<string, unknown>>): SystemIcon {
  return function IosPathIcon(props: SVGProps<SVGSVGElement>) {
    return createElement('svg', { width: 48, height: 48, viewBox: '0 0 48 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', ...props },
      ...paths.map((pathProps, index) => createElement('path', { key: index, ...pathProps })),
    )
  }
}

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const fill = { fill: 'currentColor' }

const MinimizeIcon = pathIcon([{ ...stroke, d: 'M13 24h22' }])
const SquareIcon = pathIcon([{ ...stroke, d: 'M15 15h18v18H15z' }])
const FullscreenIcon = pathIcon([
  { ...stroke, d: 'M17 13h-4v4M13 13l9 9M31 35h4v-4M35 35l-9-9M31 13h4v4M35 13l-9 9M17 35h-4v-4M13 35l9-9' },
])
const PauseIcon = pathIcon([
  { ...fill, d: 'M17 13c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2s2-.9 2-2V15c0-1.1-.9-2-2-2ZM31 13c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2s2-.9 2-2V15c0-1.1-.9-2-2-2Z' },
])
const PreviousIcon = pathIcon([
  { ...fill, d: 'M14 13c1.1 0 2 .9 2 2v6.15l14.1-7.75c1.32-.73 2.9.23 2.9 1.74v17.72c0 1.51-1.58 2.47-2.9 1.74L16 26.85V33c0 1.1-.9 2-2 2s-2-.9-2-2V15c0-1.1.9-2 2-2Z' },
])
const NextIcon = pathIcon([
  { ...fill, d: 'M34 13c-1.1 0-2 .9-2 2v6.15L17.9 13.4c-1.32-.73-2.9.23-2.9 1.74v17.72c0 1.51 1.58 2.47 2.9 1.74L32 26.85V33c0 1.1.9 2 2 2s2-.9 2-2V15c0-1.1-.9-2-2-2Z' },
])
const ThumbLikeIcon = pathIcon([
  { ...stroke, d: 'M17 21v18M17 21l6-11c.7-1.28 2.55-.95 2.78.49l.72 4.51c.17 1.08-.14 2.18-.86 3L23 21h11.2c2.5 0 4.38 2.27 3.91 4.73l-1.71 9C36.05 36.63 34.39 38 32.46 38H17M17 21h-5c-1.66 0-3 1.34-3 3v12c0 1.66 1.34 3 3 3h5' },
])
const ThumbLikeFilledIcon = pathIcon([
  { ...fill, d: 'M16 20.4 22 9.4c1.2-2.2 4.37-1.64 4.76.83l.72 4.51c.22 1.39-.18 2.81-1.11 3.86l-.35.4H34.2c3.13 0 5.48 2.84 4.89 5.91l-1.71 9C36.94 36.28 34.86 38 32.46 38H16V20.4ZM12 21h2v18h-2c-2.2 0-4-1.8-4-4V25c0-2.2 1.8-4 4-4Z' },
])
const ThumbDislikeIcon = pathIcon([
  { ...stroke, d: 'M17 27V9M17 27l6 11c.7 1.28 2.55.95 2.78-.49l.72-4.51c.17-1.08-.14-2.18-.86-3L23 27h11.2c2.5 0 4.38-2.27 3.91-4.73l-1.71-9C36.05 11.37 34.39 10 32.46 10H17M17 27h-5c-1.66 0-3-1.34-3-3V12c0-1.66 1.34-3 3-3h5' },
])
const ThumbDislikeFilledIcon = pathIcon([
  { ...fill, d: 'M16 27.6 22 38.6c1.2 2.2 4.37 1.64 4.76-.83l.72-4.51c.22-1.39-.18-2.81-1.11-3.86l-.35-.4H34.2c3.13 0 5.48-2.84 4.89-5.91l-1.71-9C36.94 11.72 34.86 10 32.46 10H16v17.6ZM12 27h2V9h-2c-2.2 0-4 1.8-4 4v10c0 2.2 1.8 4 4 4Z' },
])
const MoreIcon = pathIcon([
  { ...fill, d: 'M24 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM24 27a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM24 40a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z' },
])
const ShuffleIcon = pathIcon([
  { ...stroke, d: 'M9 16h6.5c3 0 4.75 1.35 6.5 4l4 6c1.75 2.65 3.5 4 6.5 4H39M33 24l6 6-6 6M9 32h6.5c2.3 0 3.85-.8 5.25-2.4M27.25 18.4c1.4-1.6 2.95-2.4 5.25-2.4H39M33 10l6 6-6 6' },
])
const ShuffleOffIcon = pathIcon([
  { ...stroke, d: 'M9 16h6.5c3 0 4.75 1.35 6.5 4l4 6c1.75 2.65 3.5 4 6.5 4H39M33 24l6 6-6 6M9 32h6.5c2.3 0 3.85-.8 5.25-2.4M27.25 18.4c1.4-1.6 2.95-2.4 5.25-2.4H39M33 10l6 6-6 6M10 10l28 28' },
])
const ShuffleCategoryOrderIcon = pathIcon([
  { stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', d: 'M5.5 15.7332H9.75M5.5 33.2449H9.75M5.5 24.5364H9.75' },
  { fill: 'currentColor', d: 'M39.4538 9.36612C39.0754 8.87796 38.4621 8.87796 38.0837 9.36612C37.7054 9.85427 37.7054 10.6457 38.0837 11.1339L40.6925 14.5H39.9312C33.4304 14.5 29.7389 19.1964 26.333 23.5295L26.2699 23.6099C22.8152 28.0047 19.6339 32 13.9688 32C13.4337 32 13 32.5596 13 33.25C13 33.9404 13.4337 34.5 13.9688 34.5C20.4696 34.5 24.1611 29.8036 27.567 25.4705L27.6301 25.3901C31.0848 20.9953 34.2661 17 39.9312 17H40.6925L38.0837 20.3661C37.7054 20.8543 37.7054 21.6457 38.0837 22.1339C38.4621 22.622 39.0754 22.622 39.4538 22.1339L43.7163 16.6339C44.0946 16.1457 44.0946 15.3543 43.7163 14.8661L39.4538 9.36612ZM13.9688 14.5C19.388 14.5 22.8549 17.7636 25.8315 21.3597C25.6615 21.575 25.4935 21.7888 25.3272 22.0004L25.1817 22.1857C24.9336 22.5012 24.6891 22.8115 24.4473 23.1157C21.6122 19.707 18.6319 17 13.9688 17C13.4337 17 13 16.4404 13 15.75C13 15.0596 13.4337 14.5 13.9688 14.5ZM39.9312 34.5C34.512 34.5 31.0451 31.2364 28.0685 27.6403C28.2388 27.4247 28.407 27.2106 28.5735 26.9987L28.7183 26.8143C28.9664 26.4988 29.2108 26.1885 29.4527 25.8843C32.2878 29.293 35.2681 32 39.9312 32H40.6925L38.0837 28.6339C37.7054 28.1457 37.7054 27.3543 38.0837 26.8661C38.4621 26.378 39.0754 26.378 39.4538 26.8661L43.7163 32.3661C44.0946 32.8543 44.0946 33.6457 43.7163 34.1339L39.4538 39.6339C39.0754 40.122 38.4621 40.122 38.0837 39.6339C37.7054 39.1457 37.7054 38.3543 38.0837 37.8661L40.6925 34.5H39.9312Z' },
])
const ShuffleCategoryRandomIcon = pathIcon([
  { stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', d: 'M5.26758 40.627H7.7528' },
  { fill: 'currentColor', d: 'M38.1339 8.86612C37.6457 8.37796 36.8543 8.37796 36.3661 8.86612C35.878 9.35427 35.878 10.1457 36.3661 10.6339L39.7322 14H38.75C30.3617 14 25.5986 18.6964 21.2039 23.0295L21.1224 23.1099C16.6648 27.5047 12.5599 31.5 5.25 31.5C4.55964 31.5 4 32.0596 4 32.75C4 33.4404 4.55964 34 5.25 34C13.6383 34 18.4014 29.3036 22.7961 24.9705L22.8776 24.8901C27.3352 20.4953 31.4401 16.5 38.75 16.5H39.7322L36.3661 19.8661C35.878 20.3543 35.878 21.1457 36.3661 21.6339C36.8543 22.122 37.6457 22.122 38.1339 21.6339L43.6339 16.1339C44.122 15.6457 44.122 14.8543 43.6339 14.3661L38.1339 8.86612ZM5.25 14C12.2425 14 16.716 17.2636 20.5568 20.8597C20.3374 21.075 20.1206 21.2888 19.9061 21.5004L19.7183 21.6857C19.3982 22.0012 19.0828 22.3115 18.7707 22.6157C15.1125 19.207 11.267 16.5 5.25 16.5C4.55964 16.5 4 15.9404 4 15.25C4 14.5596 4.55964 14 5.25 14ZM38.75 34C31.7575 34 27.284 30.7364 23.4432 27.1403C23.6629 26.9247 23.88 26.7106 24.0948 26.4987L24.2817 26.3143C24.6018 25.9988 24.9172 25.6885 25.2293 25.3843C28.8875 28.793 32.733 31.5 38.75 31.5H39.7322L36.3661 28.1339C35.878 27.6457 35.878 26.8543 36.3661 26.3661C36.8543 25.878 37.6457 25.878 38.1339 26.3661L43.6339 31.8661C44.122 32.3543 44.122 33.1457 43.6339 33.6339L38.1339 39.1339C37.6457 39.622 36.8543 39.622 36.3661 39.1339C35.878 38.6457 35.878 37.8543 36.3661 37.3661L39.7322 34H38.75Z' },
  { stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', d: 'M13.4253 40.627H15.9105' },
])
const RepeatOneIcon = pathIcon([
  { ...stroke, d: 'M14 16h18M32 16l-5-5M32 16l-5 5M34 32H16M16 32l5 5M16 32l5-5' },
  { ...fill, d: 'M31 26.5h1.8v10H30V30l-1.7 1.15-1.3-1.95 4-2.7Z' },
])
const SequentialIcon = pathIcon([
  { ...stroke, strokeWidth: 2.6, d: 'M9 16h30M33 10l6 6-6 6M9 32h30M33 26l6 6-6 6' },
])
const PlayAllCategoriesIcon = pathIcon([
  { stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', d: 'M8 24H10.5M16 24H19.5M25 24H39' },
  { stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M35 18L41 24L35 30' },
])
const CaptionsIcon = pathIcon([
  { ...stroke, d: 'M10 14c0-2.2 1.8-4 4-4h20c2.2 0 4 1.8 4 4v20c0 2.2-1.8 4-4 4H14c-2.2 0-4-1.8-4-4V14Z' },
  { ...stroke, strokeWidth: 2.4, d: 'M22 20.5c-1-1-2.3-1.5-3.8-1.5-3 0-5.2 2.2-5.2 5s2.2 5 5.2 5c1.5 0 2.8-.5 3.8-1.5M35 20.5c-1-1-2.3-1.5-3.8-1.5-3 0-5.2 2.2-5.2 5s2.2 5 5.2 5c1.5 0 2.8-.5 3.8-1.5' },
])
const CaptionsFilledIcon = pathIcon([
  { ...fill, d: 'M14 10h20c2.2 0 4 1.8 4 4v20c0 2.2-1.8 4-4 4H14c-2.2 0-4-1.8-4-4V14c0-2.2 1.8-4 4-4Z' },
  { d: 'M22 20.5c-1-1-2.3-1.5-3.8-1.5-3 0-5.2 2.2-5.2 5s2.2 5 5.2 5c1.5 0 2.8-.5 3.8-1.5M35 20.5c-1-1-2.3-1.5-3.8-1.5-3 0-5.2 2.2-5.2 5s2.2 5 5.2 5c1.5 0 2.8-.5 3.8-1.5', stroke: 'Canvas', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
])
const AudioWaveIcon = pathIcon([
  { ...stroke, d: 'M24 8c8.84 0 16 7.16 16 16s-7.16 16-16 16S8 32.84 8 24 15.16 8 24 8ZM18 21v6M22 17v14M26 20v8M30 15v18' },
])
const MusicIcon = pathIcon([
  { ...stroke, d: 'M19 33V13l17-4v20M19 33c0 3-2.7 5-6 5s-6-2-6-5 2.7-5 6-5 6 2 6 5ZM36 29c0 3-2.7 5-6 5s-6-2-6-5 2.7-5 6-5 6 2 6 5Z' },
])

export const iosSystemIcons: SystemIconProvider = {
  collapse: libraryIcon(Chevron as ComponentType<AnyIconProps>, { direction: 'down' }),
  fullscreen: FullscreenIcon,
  minimize: MinimizeIcon,
  maximize: SquareIcon,
  close: libraryIcon(XMark as ComponentType<AnyIconProps>),
  play: libraryIcon(Play as ComponentType<AnyIconProps>, { filled: true }),
  pause: PauseIcon,
  previous: PreviousIcon,
  next: NextIcon,
  like: ThumbLikeIcon,
  likeSelected: ThumbLikeFilledIcon,
  dislike: ThumbDislikeIcon,
  dislikeSelected: ThumbDislikeFilledIcon,
  more: MoreIcon,
  shuffle: ShuffleIcon,
  shuffleOff: ShuffleOffIcon,
  shuffleCategoryOrder: ShuffleCategoryOrderIcon,
  shuffleCategoryRandom: ShuffleCategoryRandomIcon,
  repeat: libraryIcon(Loop as ComponentType<AnyIconProps>),
  repeatOne: RepeatOneIcon,
  sequential: SequentialIcon,
  playAllCategories: PlayAllCategoriesIcon,
  captions: CaptionsIcon,
  captionsSelected: CaptionsFilledIcon,
  volume: libraryIcon(Speaker as ComponentType<AnyIconProps>, { pitch: 'normal' }),
  audioWave: AudioWaveIcon,
  queue: libraryIcon(Checklist as ComponentType<AnyIconProps>),
  music: MusicIcon,
}
