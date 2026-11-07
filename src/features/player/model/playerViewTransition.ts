export type PlayerViewTransitionPart = 'cover' | 'copy'

export type PlayerViewTransitionLayer = Readonly<{
  id: number
  trackId: string
  phase: 'preview' | 'incoming' | 'active' | 'exiting'
}>

const phasePriority: Record<PlayerViewTransitionLayer['phase'], number> = {
  incoming: 4,
  active: 3,
  preview: 2,
  exiting: 1,
}

/**
 * Select exactly one shared-element owner for each track represented in the
 * artwork pool. Incoming layers take ownership before promotion, while a
 * preview for another track can register its identity ahead of a switch.
 */
export function selectPlayerViewTransitionOwnerIds(
  layers: readonly PlayerViewTransitionLayer[],
): ReadonlySet<number> {
  const ownersByTrackId = new Map<string, PlayerViewTransitionLayer>()

  for (const layer of layers) {
    const owner = ownersByTrackId.get(layer.trackId)
    if (
      !owner
      || phasePriority[layer.phase] > phasePriority[owner.phase]
      || (phasePriority[layer.phase] === phasePriority[owner.phase] && layer.id > owner.id)
    ) ownersByTrackId.set(layer.trackId, layer)
  }

  return new Set([...ownersByTrackId.values()].map((layer) => layer.id))
}

/**
 * Build the identity shared by the selected player layer and playlist dock.
 *
 * Ownership is resolved separately so a track can preregister its preview or
 * incoming layer without allowing duplicate layout ids during artwork refresh.
 */
export function playerViewTransitionLayoutId(
  part: PlayerViewTransitionPart,
  trackId: string | null | undefined,
): string | undefined {
  return trackId ? `player-view-${part}:${trackId}` : undefined
}
