import type { Transition, Variants } from 'motion/react'
import type { AppearanceEasing, AppearanceMotion } from './appearanceTypes'

export const appearanceEasingMap: Record<AppearanceEasing, Transition['ease']> = {
  linear: 'linear',
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'cubic-bezier(.65, 0, .35, 1)': [0.65, 0, 0.35, 1],
}

export type AppearanceMotionRuntime = {
  disabled: boolean
  reducedMotion: 'always' | 'never'
  transition: Transition
  layoutTransition: Transition
  libraryNavigation: {
    transition: Transition
    chrome: Variants
    toolbar: Variants
    cover: Variants
    sidebar: Variants
    expansion: number
    columnTravel: number
  }
  layoutZoom: {
    enterScale: {
      zoomIn: number
      zoomOut: number
    }
  }
  variants: {
    backdrop: Variants
    track: Variants
    panel: Variants
    glyph: Variants
    controllerActions: Variants
  }
}

export function createAppearanceMotionRuntime(
  motion: AppearanceMotion,
  systemReducedMotion: boolean,
): AppearanceMotionRuntime {
  const disabled = systemReducedMotion || motion.level === 'off'

  if (disabled) {
    return {
      disabled: true,
      reducedMotion: 'always',
      transition: { duration: 0 },
      layoutTransition: { duration: 0 },
      libraryNavigation: {
        transition: { duration: 0 },
        chrome: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
        toolbar: { initial: { x: 0, y: 0, opacity: 1 }, animate: { x: 0, y: 0, opacity: 1 }, exit: { x: 0, y: 0, opacity: 1 } },
        cover: { initial: { x: 0, scale: 1, opacity: 1 }, animate: { x: 0, scale: 1, opacity: 1 }, exit: { x: 0, scale: 1, opacity: 1 } },
        sidebar: { initial: { x: 0, opacity: 1 }, animate: { x: 0, opacity: 1 }, exit: { x: 0, opacity: 1 } },
        expansion: 0,
        columnTravel: 0,
      },
      layoutZoom: {
        enterScale: {
          zoomIn: 1,
          zoomOut: 1,
        },
      },
      variants: {
        backdrop: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
        track: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
        panel: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
        glyph: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
        controllerActions: { hidden: { opacity: 0, x: 0 }, visible: { opacity: 1, x: 0 } },
      },
    }
  }

  const expressive = motion.level === 'expressive'
  const durationScale = motion.durationScale
  const contentDistance = expressive ? 18 : 10
  const panelDistance = expressive ? 22 : 14
  const trackScale = expressive ? 0.975 : 0.988
  const glyphScale = expressive ? 0.78 : 0.88
  const prototypeSmartTransition: Transition = {
    type: 'tween',
    duration: 0.3 * durationScale,
    ease: appearanceEasingMap['ease-out'],
  }

  return {
    disabled: false,
    reducedMotion: 'never',
    layoutTransition: prototypeSmartTransition,
    libraryNavigation: {
      transition: prototypeSmartTransition,
      expansion: 0.7,
      columnTravel: 0.55,
      chrome: {
        initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 },
      },
      toolbar: {
        initial: (offset: () => { x: number; y: number }) => ({ ...offset(), opacity: 0 }),
        animate: { x: 0, y: 0, opacity: 1 },
        exit: (offset: () => { x: number; y: number }) => ({ ...offset(), opacity: 0 }),
      },
      cover: {
        initial: { x: '60vw', scale: 0.56, opacity: 0 },
        animate: { x: 0, scale: 1, opacity: 1 },
        exit: { x: '60vw', scale: 0.56, opacity: 0 },
      },
      sidebar: {
        initial: { x: '-100%', opacity: 0 },
        animate: { x: '0%', opacity: 1 },
        exit: { x: '-100%', opacity: 0 },
      },
    },
    layoutZoom: {
      enterScale: {
        zoomIn: 0.86,
        zoomOut: 1.14,
      },
    },
    transition: {
      default: {
        type: 'spring',
        visualDuration: 0.38 * durationScale,
        bounce: expressive ? 0.16 : 0.08,
      },
      opacity: {
        type: 'tween',
        duration: 0.2 * durationScale,
        ease: appearanceEasingMap[motion.easing],
      },
    },
    variants: {
      controllerActions: {
        hidden: { opacity: 0, x: expressive ? 64 : 48 },
        visible: { opacity: 1, x: 0 },
      },
      backdrop: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      },
      track: {
        initial: { opacity: 0, scale: trackScale, x: contentDistance },
        animate: { opacity: 1, scale: 1, x: 0 },
        exit: { opacity: 0, scale: trackScale, x: -contentDistance },
      },
      panel: {
        initial: { opacity: 0, scale: 0.96, y: panelDistance },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.98, y: panelDistance / 2 },
      },
      glyph: {
        initial: { opacity: 0, scale: glyphScale },
        animate: { opacity: 1, scale: 1, transition: prototypeSmartTransition },
        exit: { opacity: 0, scale: glyphScale, transition: prototypeSmartTransition },
      },
    },
  }
}
