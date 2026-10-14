import type { ComponentType, SVGProps } from 'react'

export type SystemIcon = ComponentType<SVGProps<SVGSVGElement>>

export type SystemIconProvider = {
  collapse: SystemIcon
  fullscreen: SystemIcon
  minimize: SystemIcon
  maximize: SystemIcon
  restore: SystemIcon
  close: SystemIcon
  play: SystemIcon
  pause: SystemIcon
  previous: SystemIcon
  next: SystemIcon
  like: SystemIcon
  likeSelected: SystemIcon
  dislike: SystemIcon
  dislikeSelected: SystemIcon
  more: SystemIcon
  shuffle: SystemIcon
  shuffleOff: SystemIcon
  shuffleCategoryOrder: SystemIcon
  shuffleCategoryRandom: SystemIcon
  repeat: SystemIcon
  repeatOne: SystemIcon
  sequential: SystemIcon
  playAllCategories: SystemIcon
  captions: SystemIcon
  captionsSelected: SystemIcon
  volume: SystemIcon
  volumeMedium: SystemIcon
  volumeLow: SystemIcon
  volumeMuted: SystemIcon
  audioWave: SystemIcon
  queue: SystemIcon
  music: SystemIcon
}
