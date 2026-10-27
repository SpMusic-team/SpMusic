import type { ReactNode, Ref } from 'react'
import { motion, type Transition } from 'motion/react'
import { cn } from '@/lib/utils'

type Props = {
  artwork: ReactNode
  artworkRef: Ref<HTMLDivElement>
  category: ReactNode
  title: ReactNode
  metadata: ReactNode
  actions: ReactNode
  close?: ReactNode
  extraMetadata?: ReactNode
  localProjection: boolean
  artworkLayoutId?: string
  titleLayoutId?: string
  transition: Transition
  songKey?: string
  className?: string
}

// Both collection pages share the same frame, crop, inverse stretch and slots.
// Data, playback commands and cover ownership stay with the page.
export function CollectionHero({ artwork, artworkRef, category, title, metadata, actions, close, extraMetadata,
  localProjection, artworkLayoutId, titleLayoutId, transition, songKey, className }: Props) {
  return <header className={cn('playlist-hero', className)} data-song-key={songKey}>
    <motion.div key={localProjection ? 'hero-artwork-local' : 'hero-artwork-shared'} ref={artworkRef}
      className="playlist-hero-artwork" aria-hidden="true" layoutId={artworkLayoutId}
      layoutCrossfade={false} transition={{ layout: transition }}>{artwork}</motion.div>
    {category}
    {close}
    <div className="playlist-hero-copy">
      <motion.h1 className="playlist-hero-title" key={localProjection ? 'hero-title-local' : 'hero-title-shared'}
        layout={localProjection ? undefined : 'position'} layoutId={titleLayoutId}
        transition={{ layout: transition }}>{title}</motion.h1>
      {extraMetadata}
      {metadata}
      {actions}
    </div>
  </header>
}
