import { createElement, type SVGProps } from 'react'
import {
  ArrowRepeatAll24Regular,
  ArrowRepeat124Regular,
  ArrowShuffleOff24Regular,
  ArrowShuffle24Regular,
  ChevronDown24Regular,
  ClosedCaption24Filled,
  ClosedCaption24Regular,
  Dismiss24Regular,
  FullScreenMaximize24Regular,
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
    createElement('path', { d: 'M5.5 15.7332H9.75M5.5 33.2449H9.75M5.5 24.5364H9.75', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }),
    createElement('path', {
      d: 'M39.4538 9.36612C39.0754 8.87796 38.4621 8.87796 38.0837 9.36612C37.7054 9.85427 37.7054 10.6457 38.0837 11.1339L40.6925 14.5H39.9312C33.4304 14.5 29.7389 19.1964 26.333 23.5295L26.2699 23.6099C22.8152 28.0047 19.6339 32 13.9688 32C13.4337 32 13 32.5596 13 33.25C13 33.9404 13.4337 34.5 13.9688 34.5C20.4696 34.5 24.1611 29.8036 27.567 25.4705L27.6301 25.3901C31.0848 20.9953 34.2661 17 39.9312 17H40.6925L38.0837 20.3661C37.7054 20.8543 37.7054 21.6457 38.0837 22.1339C38.4621 22.622 39.0754 22.622 39.4538 22.1339L43.7163 16.6339C44.0946 16.1457 44.0946 15.3543 43.7163 14.8661L39.4538 9.36612ZM13.9688 14.5C19.388 14.5 22.8549 17.7636 25.8315 21.3597C25.6615 21.575 25.4935 21.7888 25.3272 22.0004L25.1817 22.1857C24.9336 22.5012 24.6891 22.8115 24.4473 23.1157C21.6122 19.707 18.6319 17 13.9688 17C13.4337 17 13 16.4404 13 15.75C13 15.0596 13.4337 14.5 13.9688 14.5ZM39.9312 34.5C34.512 34.5 31.0451 31.2364 28.0685 27.6403C28.2388 27.4247 28.407 27.2106 28.5735 26.9987L28.7183 26.8143C28.9664 26.4988 29.2108 26.1885 29.4527 25.8843C32.2878 29.293 35.2681 32 39.9312 32H40.6925L38.0837 28.6339C37.7054 28.1457 37.7054 27.3543 38.0837 26.8661C38.4621 26.378 39.0754 26.378 39.4538 26.8661L43.7163 32.3661C44.0946 32.8543 44.0946 33.6457 43.7163 34.1339L39.4538 39.6339C39.0754 40.122 38.4621 40.122 38.0837 39.6339C37.7054 39.1457 37.7054 38.3543 38.0837 37.8661L40.6925 34.5H39.9312Z',
      fill: 'currentColor',
    }),
  )
}

function ShuffleCategoryRandomIcon(props: SVGProps<SVGSVGElement>) {
  return createElement('svg', { width: 48, height: 48, viewBox: '0 0 48 48', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', ...props },
    createElement('path', { d: 'M5.26758 40.627H7.7528', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }),
    createElement('path', {
      d: 'M38.1339 8.86612C37.6457 8.37796 36.8543 8.37796 36.3661 8.86612C35.878 9.35427 35.878 10.1457 36.3661 10.6339L39.7322 14H38.75C30.3617 14 25.5986 18.6964 21.2039 23.0295L21.1224 23.1099C16.6648 27.5047 12.5599 31.5 5.25 31.5C4.55964 31.5 4 32.0596 4 32.75C4 33.4404 4.55964 34 5.25 34C13.6383 34 18.4014 29.3036 22.7961 24.9705L22.8776 24.8901C27.3352 20.4953 31.4401 16.5 38.75 16.5H39.7322L36.3661 19.8661C35.878 20.3543 35.878 21.1457 36.3661 21.6339C36.8543 22.122 37.6457 22.122 38.1339 21.6339L43.6339 16.1339C44.122 15.6457 44.122 14.8543 43.6339 14.3661L38.1339 8.86612ZM5.25 14C12.2425 14 16.716 17.2636 20.5568 20.8597C20.3374 21.075 20.1206 21.2888 19.9061 21.5004L19.7183 21.6857C19.3982 22.0012 19.0828 22.3115 18.7707 22.6157C15.1125 19.207 11.267 16.5 5.25 16.5C4.55964 16.5 4 15.9404 4 15.25C4 14.5596 4.55964 14 5.25 14ZM38.75 34C31.7575 34 27.284 30.7364 23.4432 27.1403C23.6629 26.9247 23.88 26.7106 24.0948 26.4987L24.2817 26.3143C24.6018 25.9988 24.9172 25.6885 25.2293 25.3843C28.8875 28.793 32.733 31.5 38.75 31.5H39.7322L36.3661 28.1339C35.878 27.6457 35.878 26.8543 36.3661 26.3661C36.8543 25.878 37.6457 25.878 38.1339 26.3661L43.6339 31.8661C44.122 32.3543 44.122 33.1457 43.6339 33.6339L38.1339 39.1339C37.6457 39.622 36.8543 39.622 36.3661 39.1339C35.878 38.6457 35.878 37.8543 36.3661 37.3661L39.7322 34H38.75Z',
      fill: 'currentColor',
    }),
    createElement('path', { d: 'M13.4253 40.627H15.9105', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }),
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
  shuffle: ArrowShuffle24Regular,
  shuffleOff: ArrowShuffleOff24Regular,
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
