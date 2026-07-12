import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SystemIcon } from '@/icons/systemIcons'

type IconButtonProps = {
  label: string
  icon: SystemIcon
  selected?: boolean
} & ComponentProps<typeof Button>

export function IconButton({ label, icon: Icon, selected = false, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={label} aria-pressed={selected} data-selected={selected} size="icon" type="button" variant="ghost" {...props} />}>
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
