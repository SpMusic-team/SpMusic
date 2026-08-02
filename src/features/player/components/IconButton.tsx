import type { ComponentProps } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import type { SystemIcon } from '@/icons/systemIcons'

type IconButtonProps = {
  label: string
  icon: SystemIcon
  selected?: boolean
  animated?: boolean
} & ComponentProps<typeof Button>

export function IconButton({ label, icon: Icon, selected = false, animated = false, ...props }: IconButtonProps) {
  const appearanceMotion = useAppearanceMotion()

  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={label} aria-pressed={selected} data-selected={selected} size="icon" type="button" variant="ghost" {...props} />}>
        {animated ? (
          <span className="player-control-icon-swap">
            <AnimatePresence initial={false}>
              <motion.span
                key={selected ? 'selected' : 'idle'}
                className="player-control-icon-frame"
                variants={appearanceMotion.variants.glyph}
                initial="initial"
                animate="animate"
                exit="exit"
                aria-hidden="true"
              >
                <Icon />
              </motion.span>
            </AnimatePresence>
          </span>
        ) : (
          <span className="player-control-icon-frame" aria-hidden="true">
            <Icon />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
