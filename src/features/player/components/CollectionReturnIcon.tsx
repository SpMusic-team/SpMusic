import type { SVGProps } from 'react'
import arrowTurnRightUp from '@/assets/playlist-library/427b5.svg'

/** Keep the original return artwork and existing SVG geometry/theme contracts. */
export function CollectionReturnIcon({ style, ...props }: SVGProps<SVGSVGElement>) {
  return <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" {...props}
    style={{ maskImage: `url("${arrowTurnRightUp}")`, maskSize: 'contain', maskPosition: 'center', maskRepeat: 'no-repeat', ...style }}>
    <rect width="28" height="28" fill="currentColor" />
  </svg>
}
