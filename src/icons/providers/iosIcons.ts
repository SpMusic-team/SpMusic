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
  strokeWidth: 3.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const fill = { fill: 'currentColor' }

const MinimizeIcon = pathIcon([{ ...stroke, d: 'M13 24h22' }])
const SquareIcon = pathIcon([{ ...stroke, d: 'M15 15h18v18H15z' }])
const RestoreIcon = pathIcon([
  { ...stroke, d: 'M13 19h16v16H13z' },
  { ...stroke, d: 'M19 13h16v16' },
])
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
  { ...stroke, d: 'M8.5 15.5H15.5C19 15.5 21.3 17.2 23.35 20.35L26.65 25.65C28.7 28.8 31 30.5 34.5 30.5H40M34 24.5L40 30.5L34 36.5M8.5 32.5H15.5C18.2 32.5 20.2 31.5 22 29.45M27 18.55C28.8 16.5 30.8 15.5 33.5 15.5H40M34 9.5L40 15.5L34 21.5' },
])
const ShuffleOffIcon = pathIcon([
  { ...stroke, d: 'M8.5 15.5H15.5C19 15.5 21.3 17.2 23.35 20.35L26.65 25.65C28.7 28.8 31 30.5 34.5 30.5H40M34 24.5L40 30.5L34 36.5M8.5 32.5H15.5C18.2 32.5 20.2 31.5 22 29.45M27 18.55C28.8 16.5 30.8 15.5 33.5 15.5H40M34 9.5L40 15.5L34 21.5M10.5 10.5L37.5 37.5' },
])
const ShuffleCategoryOrderIcon = pathIcon([
  { ...stroke, d: 'M5.5 15.5H9.5M5.5 24H9.5M5.5 32.5H9.5M13.5 15.5H17.5C21 15.5 23.3 17.2 25.35 20.35L28.65 25.65C30.7 28.8 33 30.5 36.5 30.5H40M34 24.5L40 30.5L34 36.5M13.5 32.5H17.5C20.2 32.5 22.2 31.5 24 29.45M29 18.55C30.8 16.5 32.8 15.5 35.5 15.5H40M34 9.5L40 15.5L34 21.5' },
])
const ShuffleCategoryRandomIcon = pathIcon([
  { ...stroke, d: 'M8.5 15.5H15.5C19 15.5 21.3 17.2 23.35 20.35L26.65 25.65C28.7 28.8 31 30.5 34.5 30.5H40M34 24.5L40 30.5L34 36.5M8.5 32.5H15.5C18.2 32.5 20.2 31.5 22 29.45M27 18.55C28.8 16.5 30.8 15.5 33.5 15.5H40M34 9.5L40 15.5L34 21.5M7 39H9.5M15 39H17.5' },
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
  restore: RestoreIcon,
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
