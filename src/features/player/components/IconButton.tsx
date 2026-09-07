import type { ButtonHTMLAttributes, ComponentProps } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppearanceMotion } from '@/features/appearance/hooks/useAppearance'
import { PressFeedbackButton } from '@/features/player/components/PressFeedbackButton'
import type { SystemIcon } from '@/icons/systemIcons'
import { cn } from '@/lib/utils'

type IconButtonProps = {
  label: string
  icon: SystemIcon
  selected?: boolean
  animated?: boolean
  pressFeedback?: boolean
  pressFeedbackTone?: 'surface-variant' | 'secondary-container'
} & ComponentProps<typeof Button>

export function IconButton({
  label,
  icon: Icon,
  selected = false,
  animated = false,
  pressFeedback = false,
  pressFeedbackTone = 'secondary-container',
  className,
  size = 'icon',
  variant = 'ghost',
  ...props
}: IconButtonProps) {
  const appearanceMotion = useAppearanceMotion()
  const pressFeedbackProps = props as ButtonHTMLAttributes<HTMLButtonElement>
  const content = animated ? (
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
  )
  const button = pressFeedback ? (
    <PressFeedbackButton
      aria-label={label}
      aria-pressed={selected}
      data-selected={selected}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }), 'cover-press-feedback-button')}
      tone={pressFeedbackTone}
      type="button"
      {...pressFeedbackProps}
    >
      {content}
    </PressFeedbackButton>
  ) : (
    <Button aria-label={label} aria-pressed={selected} data-selected={selected} size={size} type="button" variant={variant} className={className} {...props}>
      {content}
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
