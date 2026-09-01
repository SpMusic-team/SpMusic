import { createElement, type SVGProps } from 'react'
import {
  ArrowRepeat124Regular,
  ClosedCaption24Filled,
  ClosedCaption24Regular,
  MusicNote224Regular,
  Play24Filled,
  Speaker024Regular,
  Speaker124Regular,
  Speaker224Regular,
  SpeakerMute24Regular,
  SquareMultiple24Regular,
  ThumbDislike24Filled,
  ThumbDislike24Regular,
  ThumbLike24Filled,
  ThumbLike24Regular,
} from '@fluentui/react-icons'
import type { SystemIcon, SystemIconProvider } from '@/icons/types'

function createFigmaIcon(viewBox: string, innerHtml: string): SystemIcon {
  function FigmaIcon({ style, ...props }: SVGProps<SVGSVGElement>) {
    return createElement('svg', {
      width: 48,
      height: 48,
      viewBox,
      fill: 'none',
      focusable: false,
      'aria-hidden': true,
      xmlns: 'http://www.w3.org/2000/svg',
      ...props,
      style: { display: 'block', ...style },
      dangerouslySetInnerHTML: { __html: innerHtml },
    })
  }

  return FigmaIcon
}

const DefaultShuffleIcon = createFigmaIcon('0 0 48 48', `<path d="M8.5 15.5H15.5C19 15.5 21.3 17.2 23.35 20.35L26.65 25.65C28.7 28.8 31 30.5 34.5 30.5H40M34 24.5L40 30.5L34 36.5M8.5 32.5H15.5C18.2 32.5 20.2 31.5 22 29.45M27 18.55C28.8 16.5 30.8 15.5 33.5 15.5H40M34 9.5L40 15.5L34 21.5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`)
const DefaultShuffleOffIcon = createFigmaIcon('0 0 48 48', `<path d="M8.5 15.5H15.5C19 15.5 21.3 17.2 23.35 20.35L26.65 25.65C28.7 28.8 31 30.5 34.5 30.5H40M34 24.5L40 30.5L34 36.5M8.5 32.5H15.5C18.2 32.5 20.2 31.5 22 29.45M27 18.55C28.8 16.5 30.8 15.5 33.5 15.5H40M34 9.5L40 15.5L34 21.5M10.5 10.5L37.5 37.5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`)
const DefaultShuffleCategoryOrderIcon = createFigmaIcon('0 0 48 48', `<path d="M5.5 15.5H9.5M5.5 24H9.5M5.5 32.5H9.5M13.5 15.5H17.5C21 15.5 23.3 17.2 25.35 20.35L28.65 25.65C30.7 28.8 33 30.5 36.5 30.5H40M34 24.5L40 30.5L34 36.5M13.5 32.5H17.5C20.2 32.5 22.2 31.5 24 29.45M29 18.55C30.8 16.5 32.8 15.5 35.5 15.5H40M34 9.5L40 15.5L34 21.5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`)
const DefaultShuffleCategoryRandomIcon = createFigmaIcon('0 0 48 48', `<path d="M8.5 15.5H15.5C19 15.5 21.3 17.2 23.35 20.35L26.65 25.65C28.7 28.8 31 30.5 34.5 30.5H40M34 24.5L40 30.5L34 36.5M8.5 32.5H15.5C18.2 32.5 20.2 31.5 22 29.45M27 18.55C28.8 16.5 30.8 15.5 33.5 15.5H40M34 9.5L40 15.5L34 21.5M7 39H9.5M15 39H17.5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`)
const DefaultSequentialIcon = createFigmaIcon('0 0 48 48', `<path d="M8.5 15H39.5M33.5 21L39.5 15L33.5 9M8.5 33H39.5M33.5 39L39.5 33L33.5 27" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
const DefaultPlayAllCategoriesIcon = createFigmaIcon('0 0 48 48', `<path d="M8 24H10.5M16 24H19.5M25 24H39" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M35 18L41 24L35 30" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
const FigmaDismissIcon = createFigmaIcon('0 0 20 20', `<g id="Dismiss"><path id="Shape" d="M4.08859 4.21569L4.14645 4.14645C4.32001 3.97288 4.58944 3.9536 4.78431 4.08859L4.85355 4.14645L10 9.293L15.1464 4.14645C15.32 3.97288 15.5894 3.9536 15.7843 4.08859L15.8536 4.14645C16.0271 4.32001 16.0464 4.58944 15.9114 4.78431L15.8536 4.85355L10.707 10L15.8536 15.1464C16.0271 15.32 16.0464 15.5894 15.9114 15.7843L15.8536 15.8536C15.68 16.0271 15.4106 16.0464 15.2157 15.9114L15.1464 15.8536L10 10.707L4.85355 15.8536C4.67999 16.0271 4.41056 16.0464 4.21569 15.9114L4.14645 15.8536C3.97288 15.68 3.9536 15.4106 4.08859 15.2157L4.14645 15.1464L9.293 10L4.14645 4.85355C3.97288 4.67999 3.9536 4.41056 4.08859 4.21569L4.14645 4.14645L4.08859 4.21569Z" fill="var(--fill-0, currentColor)"/></g>`)
const DefaultRepeatIcon = createFigmaIcon('0 0 24 24', `<path d="m14.61 2.47-.08-.07a.75.75 0 0 0-.98.07l-.07.08c-.22.3-.2.72.07.98l1.97 1.98H8.27a6.51 6.51 0 0 0-4.58 10.92l.07.06a.75.75 0 0 0 1.08-1.03l-.2-.23A5 5 0 0 1 8.5 7.02h6.88l-1.83 1.84-.07.07c-.22.3-.2.72.07 1 .3.29.77.29 1.06 0l3.18-3.2.07-.08c.22-.3.2-.72-.07-.99l-3.18-3.19Zm5.62 5.1a.75.75 0 0 0-1.05 1.07 5.01 5.01 0 0 1-3.68 8.41H8.56l1.9-1.9.08-.1c.2-.26.2-.63 0-.9l-.08-.07-.08-.08a.75.75 0 0 0-.9.01l-.08.07-3.18 3.2-.07.08c-.2.26-.2.63 0 .9l.07.08 3.18 3.19.09.07c.29.22.7.2.97-.07s.3-.7.07-.99l-.07-.07-1.9-1.91H15.73A6.51 6.51 0 0 0 20.3 7.63l-.07-.07Z" fill="var(--fill-0, currentColor)"/>`)
const FigmaAudioWaveIcon = createFigmaIcon('0 0 48 48', `<g id="Sound Wave Circle"><path id="Shape" d="M24 6.5C14.335 6.5 6.5 14.335 6.5 24C6.5 33.665 14.335 41.5 24 41.5C33.665 41.5 41.5 33.665 41.5 24C41.5 14.335 33.665 6.5 24 6.5ZM4 24C4 12.9543 12.9543 4 24 4C35.0457 4 44 12.9543 44 24C44 35.0457 35.0457 44 24 44C12.9543 44 4 35.0457 4 24ZM20.75 16C21.4404 16 22 16.5596 22 17.25V30.75C22 31.4404 21.4404 32 20.75 32C20.0596 32 19.5 31.4404 19.5 30.75V17.25C19.5 16.5596 20.0596 16 20.75 16ZM34 17.25C34 16.5596 33.4404 16 32.75 16C32.0596 16 31.5 16.5596 31.5 17.25V30.75C31.5 31.4404 32.0596 32 32.75 32C33.4404 32 34 31.4404 34 30.75V17.25ZM14.75 20C15.4404 20 16 20.5596 16 21.25V26.75C16 27.4404 15.4404 28 14.75 28C14.0596 28 13.5 27.4404 13.5 26.75V21.25C13.5 20.5596 14.0596 20 14.75 20ZM28 20.25C28 19.5596 27.4404 19 26.75 19C26.0596 19 25.5 19.5596 25.5 20.25V27.75C25.5 28.4404 26.0596 29 26.75 29C27.4404 29 28 28.4404 28 27.75V20.25Z" fill="var(--fill-0, currentColor)"/></g>`)
const FigmaMoreIcon = createFigmaIcon('0 0 48 48', `<g id="More Vertical"><path id="Shape" d="M24.002 15.75C22.207 15.75 20.752 14.2949 20.752 12.5C20.752 10.7051 22.207 9.25 24.002 9.25C25.7969 9.25 27.252 10.7051 27.252 12.5C27.252 14.2949 25.7969 15.75 24.002 15.75ZM24.002 27.25C22.207 27.25 20.752 25.7949 20.752 24C20.752 22.2051 22.207 20.75 24.002 20.75C25.7969 20.75 27.252 22.2051 27.252 24C27.252 25.7949 25.7969 27.25 24.002 27.25ZM20.752 35.5C20.752 37.2949 22.207 38.75 24.002 38.75C25.7969 38.75 27.252 37.2949 27.252 35.5C27.252 33.7051 25.7969 32.25 24.002 32.25C22.207 32.25 20.752 33.7051 20.752 35.5Z" fill="var(--fill-0, currentColor)"/></g>`)
const FigmaMaximizeIcon = createFigmaIcon('0 0 20 20', `<g id="Maximize"><path id="Shape" d="M3 5C3 3.89543 3.89543 3 5 3H15C16.1046 3 17 3.89543 17 5V15C17 16.1046 16.1046 17 15 17H5C3.89543 17 3 16.1046 3 15V5ZM5 4C4.44772 4 4 4.44772 4 5V15C4 15.5523 4.44772 16 5 16H15C15.5523 16 16 15.5523 16 15V5C16 4.44772 15.5523 4 15 4H5Z" fill="var(--fill-0, currentColor)"/></g>`)
const FigmaChevronIcon = createFigmaIcon('0 0 20 20', `<g id="Chevron"><path id="Shape" d="M15.8527 7.64582C16.0484 7.84073 16.0489 8.15731 15.854 8.35292L10.389 13.8374C10.1741 14.0531 9.82477 14.0531 9.60982 13.8374L4.14484 8.35292C3.94993 8.15731 3.95049 7.84073 4.1461 7.64582C4.34171 7.4509 4.65829 7.45147 4.85321 7.64708L9.99942 12.8117L15.1456 7.64708C15.3406 7.45147 15.6571 7.4509 15.8527 7.64582Z" fill="var(--fill-0, currentColor)"/></g>`)
const FigmaNextIcon = createFigmaIcon('0 0 32 32', `<g id="Next"><path id="Shape" d="M26.002 5C26.002 4.44772 26.4497 4 27.002 4C27.5542 4 28.002 4.44772 28.002 5V27C28.002 27.5523 27.5542 28 27.002 28C26.4497 28 26.002 27.5523 26.002 27V5ZM3.99913 6.50423C3.99913 4.50211 6.23517 3.31225 7.89574 4.43072L21.8991 13.8626C23.3647 14.8498 23.3714 17.0046 21.912 18.0009L7.90865 27.5603C6.24924 28.6931 3.99913 27.5047 3.99913 25.4955V6.50423Z" fill="var(--fill-0, currentColor)"/></g>`)
const FigmaPauseIcon = createFigmaIcon('0 0 48 48', `<g id="&#230;&#146;&#173;&#230;&#148;&#190;&#231;&#138;&#182;&#230;&#128;&#129;"><path id="Shape" d="M11.75 6C9.67893 6 8 7.67893 8 9.75V38.25C8 40.3211 9.67893 42 11.75 42H18.25C20.3211 42 22 40.3211 22 38.25V9.75C22 7.67893 20.3211 6 18.25 6H11.75ZM29.75 6C27.6789 6 26 7.67893 26 9.75V38.25C26 40.3211 27.6789 42 29.75 42H36.25C38.3211 42 40 40.3211 40 38.25V9.75C40 7.67893 38.3211 6 36.25 6H29.75Z" fill="var(--fill-0, currentColor)"/></g>`)
const FigmaPreviousIcon = createFigmaIcon('0 0 32 32', `<g id="Previous"><path id="Shape" d="M6 5C6 4.44772 5.55228 4 5 4C4.44772 4 4 4.44772 4 5V27C4 27.5523 4.44772 28 5 28C5.55228 28 6 27.5523 6 27V5ZM28.0028 6.50423C28.0028 4.50211 25.7668 3.31225 24.1062 4.43072L10.1029 13.8626C8.63724 14.8498 8.63052 17.0046 10.09 18.0009L24.0933 27.5603C25.7527 28.6931 28.0028 27.5047 28.0028 25.4955V6.50423Z" fill="var(--fill-0, currentColor)"/></g>`)
const FigmaNavigationIcon = createFigmaIcon('0 0 48 48', `<g id="Navigation"><path id="Shape" d="M4 11.25C4 10.5596 4.55964 10 5.25 10H42.75C43.4404 10 44 10.5596 44 11.25C44 11.9404 43.4404 12.5 42.75 12.5H5.25C4.55964 12.5 4 11.9404 4 11.25ZM4 24.25C4 23.5596 4.55964 23 5.25 23H42.75C43.4404 23 44 23.5596 44 24.25C44 24.9404 43.4404 25.5 42.75 25.5H5.25C4.55964 25.5 4 24.9404 4 24.25ZM5.25 36C4.55964 36 4 36.5596 4 37.25C4 37.9404 4.55964 38.5 5.25 38.5H42.75C43.4404 38.5 44 37.9404 44 37.25C44 36.5596 43.4404 36 42.75 36H5.25Z" fill="var(--fill-0, currentColor)"/></g>`)
const FigmaFullscreenIcon = createFigmaIcon('0 0 20 20', `<g id="Full Screen Maximize"><path id="Shape" d="M3 5C3 3.89543 3.89543 3 5 3H7C7.27614 3 7.5 3.22386 7.5 3.5C7.5 3.77614 7.27614 4 7 4H5C4.44772 4 4 4.44772 4 5V7C4 7.27614 3.77614 7.5 3.5 7.5C3.22386 7.5 3 7.27614 3 7V5ZM12.5 3.5C12.5 3.22386 12.7239 3 13 3H15C16.1046 3 17 3.89543 17 5V7C17 7.27614 16.7761 7.5 16.5 7.5C16.2239 7.5 16 7.27614 16 7V5C16 4.44772 15.5523 4 15 4H13C12.7239 4 12.5 3.77614 12.5 3.5ZM3.5 12.5C3.77614 12.5 4 12.7239 4 13V15C4 15.5523 4.44772 16 5 16H7C7.27614 16 7.5 16.2239 7.5 16.5C7.5 16.7761 7.27614 17 7 17H5C3.89543 17 3 16.1046 3 15V13C3 12.7239 3.22386 12.5 3.5 12.5ZM16.5 12.5C16.7761 12.5 17 12.7239 17 13V15C17 16.1046 16.1046 17 15 17H13C12.7239 17 12.5 16.7761 12.5 16.5C12.5 16.2239 12.7239 16 13 16H15C15.5523 16 16 15.5523 16 15V13C16 12.7239 16.2239 12.5 16.5 12.5Z" fill="var(--fill-0, currentColor)"/></g>`)
const FigmaSubtractIcon = createFigmaIcon('0 0 20 20', `<g id="Subtract"><path id="Shape" d="M3 10C3 9.72386 3.22386 9.5 3.5 9.5H16.5C16.7761 9.5 17 9.72386 17 10C17 10.2761 16.7761 10.5 16.5 10.5H3.5C3.22386 10.5 3 10.2761 3 10Z" fill="var(--fill-0, currentColor)"/></g>`)
export const defaultSystemIcons: SystemIconProvider = {
  collapse: FigmaChevronIcon,
  fullscreen: FigmaFullscreenIcon,
  minimize: FigmaSubtractIcon,
  maximize: FigmaMaximizeIcon,
  restore: SquareMultiple24Regular,
  close: FigmaDismissIcon,
  play: Play24Filled,
  pause: FigmaPauseIcon,
  previous: FigmaPreviousIcon,
  next: FigmaNextIcon,
  like: ThumbLike24Regular,
  likeSelected: ThumbLike24Filled,
  dislike: ThumbDislike24Regular,
  dislikeSelected: ThumbDislike24Filled,
  more: FigmaMoreIcon,
  shuffle: DefaultShuffleIcon,
  shuffleOff: DefaultShuffleOffIcon,
  shuffleCategoryOrder: DefaultShuffleCategoryOrderIcon,
  shuffleCategoryRandom: DefaultShuffleCategoryRandomIcon,
  repeat: DefaultRepeatIcon,
  repeatOne: ArrowRepeat124Regular,
  sequential: DefaultSequentialIcon,
  playAllCategories: DefaultPlayAllCategoriesIcon,
  captions: ClosedCaption24Regular,
  captionsSelected: ClosedCaption24Filled,
  volume: Speaker224Regular,
  volumeMedium: Speaker124Regular,
  volumeLow: Speaker024Regular,
  volumeMuted: SpeakerMute24Regular,
  audioWave: FigmaAudioWaveIcon,
  queue: FigmaNavigationIcon,
  music: MusicNote224Regular,
}
