import type { Transition, Variants } from 'motion/react'
import type { AppearanceEasing, AppearanceMotion } from './appearanceTypes'

const easingMap: Record<AppearanceEasing, Transition['ease']> = {
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
  variants: {
    backdrop: Variants
    track: Variants
    panel: Variants
    glyph: Variants
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
      variants: {
        backdrop: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
        track: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
        panel: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
        glyph: { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } },
      },
    }
  }

  const expressive = motion.level === 'expressive'
  const durationScale = motion.durationScale
  const contentDistance = expressive ? 18 : 10
  const panelDistance = expressive ? 22 : 14
  const trackScale = expressive ? 0.975 : 0.988
  const glyphScale = expressive ? 0.78 : 0.88

  return {
    disabled: false,
    reducedMotion: 'never',
    transition: {
      default: {
        type: 'spring',
        visualDuration: 0.38 * durationScale,
        bounce: expressive ? 0.16 : 0.08,
      },
      opacity: {
        type: 'tween',
        duration: 0.2 * durationScale,
        ease: easingMap[motion.easing],
      },
    },
    variants: {
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
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: glyphScale },
      },
    },
  }
}
