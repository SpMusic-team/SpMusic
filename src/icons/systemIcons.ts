import type { ComponentType, SVGProps } from 'react'
import {
  ArrowRepeatAll24Regular,
  ArrowShuffle24Regular,
  ChevronDown24Regular,
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
  Square24Regular,
  Subtract24Regular,
  ThumbDislike24Filled,
  ThumbDislike24Regular,
  ThumbLike24Filled,
  ThumbLike24Regular,
} from '@fluentui/react-icons'

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
  repeat: SystemIcon
  captions: SystemIcon
  volume: SystemIcon
  queue: SystemIcon
  music: SystemIcon
}

// App code depends on semantic roles only. A future OS detector can select a
// different provider here without changing player components.
const fluentSystemIcons: SystemIconProvider = {
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
  repeat: ArrowRepeatAll24Regular,
  captions: ClosedCaption24Regular,
  volume: Speaker224Regular,
  queue: List24Regular,
  music: MusicNote224Regular,
}

export const systemIcons = fluentSystemIcons
