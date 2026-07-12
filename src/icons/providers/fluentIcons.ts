import { createElement, type SVGProps } from 'react'
import {
  ArrowRepeatAll24Regular,
  ArrowRepeat124Regular,
  ChevronDown24Regular,
  ClosedCaption24Filled,
  ClosedCaption24Regular,
  Dismiss24Regular,
  FullScreenMaximize24Regular,
  SquareMultiple24Regular,
  List24Regular,
  MoreVertical24Regular,
  MusicNote224Regular,
  Next24Regular,
  Pause24Filled,
  Play24Filled,
  Previous24Regular,
  Speaker224Regular,
  SoundWaveCircle24Regular,
  Square24Regular,
  Subtract24Regular,
  ThumbDislike24Filled,
  ThumbDislike24Regular,
  ThumbLike24Filled,
  ThumbLike24Regular,
} from '@fluentui/react-icons'
import type { SystemIconProvider } from '@/icons/types'

const iconStroke = {
  stroke: 'currentColor',
  strokeWidth: 3.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function ShuffleIcon(props: SVGProps<SVGSVGElement>) {
  return createElement('svg', { width: 48, height: 48, viewBox: '0 0 48 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', ...props },
    createElement('path', {
      d: 'M8.5 15.5H15.5C19 15.5 21.3 17.2 23.35 20.35L26.65 25.65C28.7 28.8 31 30.5 34.5 30.5H40M34 24.5L40 30.5L34 36.5M8.5 32.5H15.5C18.2 32.5 20.2 31.5 22 29.45M27 18.55C28.8 16.5 30.8 15.5 33.5 15.5H40M34 9.5L40 15.5L34 21.5',
      ...iconStroke,
    }),
  )
}

function ShuffleOffIcon(props: SVGProps<SVGSVGElement>) {
  return createElement('svg', { width: 48, height: 48, viewBox: '0 0 48 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', ...props },
    createElement('path', {
      d: 'M8.5 15.5H15.5C19 15.5 21.3 17.2 23.35 20.35L26.65 25.65C28.7 28.8 31 30.5 34.5 30.5H40M34 24.5L40 30.5L34 36.5M8.5 32.5H15.5C18.2 32.5 20.2 31.5 22 29.45M27 18.55C28.8 16.5 30.8 15.5 33.5 15.5H40M34 9.5L40 15.5L34 21.5M10.5 10.5L37.5 37.5',
      ...iconStroke,
    }),
  )
}

function SequentialIcon(props: SVGProps<SVGSVGElement>) {
  return createElement('svg', { width: 48, height: 48, viewBox: '0 0 48 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', ...props },
    createElement('path', {
      d: 'M8.5 15H39.5M33.5 21L39.5 15L33.5 9M8.5 33H39.5M33.5 39L39.5 33L33.5 27',
      stroke: 'currentColor',
      strokeWidth: 3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

function ShuffleCategoryOrderIcon(props: SVGProps<SVGSVGElement>) {
  return createElement('svg', { width: 48, height: 48, viewBox: '0 0 48 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', ...props },
    createElement('path', {
      d: 'M5.5 15.5H9.5M5.5 24H9.5M5.5 32.5H9.5M13.5 15.5H17.5C21 15.5 23.3 17.2 25.35 20.35L28.65 25.65C30.7 28.8 33 30.5 36.5 30.5H40M34 24.5L40 30.5L34 36.5M13.5 32.5H17.5C20.2 32.5 22.2 31.5 24 29.45M29 18.55C30.8 16.5 32.8 15.5 35.5 15.5H40M34 9.5L40 15.5L34 21.5',
      ...iconStroke,
    }),
  )
}

function ShuffleCategoryRandomIcon(props: SVGProps<SVGSVGElement>) {
  return createElement('svg', { width: 48, height: 48, viewBox: '0 0 48 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', ...props },
    createElement('path', {
      d: 'M8.5 15.5H15.5C19 15.5 21.3 17.2 23.35 20.35L26.65 25.65C28.7 28.8 31 30.5 34.5 30.5H40M34 24.5L40 30.5L34 36.5M8.5 32.5H15.5C18.2 32.5 20.2 31.5 22 29.45M27 18.55C28.8 16.5 30.8 15.5 33.5 15.5H40M34 9.5L40 15.5L34 21.5M7 39H9.5M15 39H17.5',
      ...iconStroke,
    }),
  )
}

function PlayAllCategoriesIcon(props: SVGProps<SVGSVGElement>) {
  return createElement('svg', { width: 48, height: 48, viewBox: '0 0 48 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', ...props },
    createElement('path', { d: 'M8 24H10.5M16 24H19.5M25 24H39', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }),
    createElement('path', { d: 'M35 18L41 24L35 30', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
  )
}

export const fluentSystemIcons: SystemIconProvider = {
  collapse: ChevronDown24Regular,
  fullscreen: FullScreenMaximize24Regular,
  minimize: Subtract24Regular,
  maximize: Square24Regular,
  restore: SquareMultiple24Regular,
  close: Dismiss24Regular,
  play: Play24Filled,
  pause: Pause24Filled,
  previous: Previous24Regular,
  next: Next24Regular,
  like: ThumbLike24Regular,
  likeSelected: ThumbLike24Filled,
  dislike: ThumbDislike24Regular,
  dislikeSelected: ThumbDislike24Filled,
  more: MoreVertical24Regular,
  shuffle: ShuffleIcon,
  shuffleOff: ShuffleOffIcon,
  shuffleCategoryOrder: ShuffleCategoryOrderIcon,
  shuffleCategoryRandom: ShuffleCategoryRandomIcon,
  repeat: ArrowRepeatAll24Regular,
  repeatOne: ArrowRepeat124Regular,
  sequential: SequentialIcon,
  playAllCategories: PlayAllCategoriesIcon,
  captions: ClosedCaption24Regular,
  captionsSelected: ClosedCaption24Filled,
  volume: Speaker224Regular,
  audioWave: SoundWaveCircle24Regular,
  queue: List24Regular,
  music: MusicNote224Regular,
}
