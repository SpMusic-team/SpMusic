import type { ComponentType, SVGProps } from 'react'

export type SystemIcon = ComponentType<SVGProps<SVGSVGElement>>

export type SystemIconProvider = {
  collapse: SystemIcon
  fullscreen: SystemIcon
  minimize: SystemIcon
  maximize: SystemIcon
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
  repeat: SystemIcon
  repeatOne: SystemIcon
  sequential: SystemIcon
  captions: SystemIcon
  volume: SystemIcon
  audioWave: SystemIcon
  queue: SystemIcon
  music: SystemIcon
}
