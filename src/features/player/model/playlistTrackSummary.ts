import type { CoverTone, Track } from '@/features/player/model/playerTypes'
import type { AudioFolderTrackRef, PlaylistTrackTagSummary } from '@/features/player/services/audioCommands'

/** Summary cache status of one playlist scope. `ready` covers degraded passes. */
export type PlaylistSummaryStatus = 'loading' | 'ready'

/**
 * One playlist row built from the read-only tag summary channel. It mirrors the
 * fields `audioTrackToPlaylistVisual` publishes for the same descriptor so the
 * expensive hydration path cannot make the visible text jump when it lands.
 */
export type PlaylistTrackRow = {
  id: string
  title: string
  artist: string
  album: string
  libraryAlbumName?: string | null
  libraryArtistName?: string | null
  libraryComposerName?: string | null
  libraryYear?: number | null
  albumArtist?: string | null
  durationSeconds: number
  fileExtension?: string
  coverTone: CoverTone
  audioFormat?: Track['audioFormat']
}

/**
 * The row shown before any tag is known. It carries the real filename-derived
 * title and deliberately empty artist/album strings: an empty string means
 * "unknown", never a substitute playlist name or a fabricated default.
 */
export type PlaylistPendingTrackRow = {
  id: string
  title: string
  artist: string
  album: string
}

export function nonEmptyText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function nonEmptyYear(value: number | null | undefined): number | null {
  return value != null && Number.isSafeInteger(value) && value > 0 && value <= 0xffff_ffff ? value : null
}

export function fileNameTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, '') || fileName
}

export function fileExtension(fileName: string): string | undefined {
  const match = /\.([^.]+)$/u.exec(fileName)
  return match?.[1]?.toLowerCase()
}

const COVER_TONES: readonly CoverTone[] = ['lagoon', 'violet', 'rose', 'amber', 'blue']

export function coverToneForTrackId(id: string): CoverTone {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return COVER_TONES[hash % COVER_TONES.length] ?? 'blue'
}

export function normalizeAudioSourcePath(sourcePath: string): string {
  // Rust canonicalizes DTO paths; the frontend only unifies separators and preserves case/UNC identity.
  return sourcePath.replaceAll('\\', '/')
}

function summaryAudioFormat(summary: PlaylistTrackTagSummary | null): Track['audioFormat'] {
  if (!summary) return undefined
  if (
    summary.bitDepth === null
    && summary.sampleRateHz === null
    && summary.bitrateKbps === null
    && summary.codec === null
  ) return undefined
  return {
    bitDepth: summary.bitDepth,
    sampleRateHz: summary.sampleRateHz,
    bitrateKbps: summary.bitrateKbps,
    codec: summary.codec,
  }
}

/**
 * Applies exactly the same fallback rules as `audioTrackToPlaylistVisual`:
 * title → file name, artist → album artist → 本地音频, album → 本地音频.
 */
export function playlistTrackRowFromSummary(
  descriptor: Pick<AudioFolderTrackRef, 'id' | 'fileName'>,
  summary: PlaylistTrackTagSummary | null,
): PlaylistTrackRow {
  return {
    id: descriptor.id,
    title: nonEmptyText(summary?.title) ?? fileNameTitle(descriptor.fileName),
    artist: nonEmptyText(summary?.artist) ?? nonEmptyText(summary?.albumArtist) ?? '本地音频',
    album: nonEmptyText(summary?.album) ?? '本地音频',
    libraryAlbumName: nonEmptyText(summary?.album) ?? null,
    libraryArtistName: nonEmptyText(summary?.artist) ?? null,
    libraryComposerName: nonEmptyText(summary?.composer) ?? null,
    libraryYear: nonEmptyYear(summary?.year),
    albumArtist: nonEmptyText(summary?.albumArtist) ?? null,
    // The tag channel deliberately carries no duration: a container header
    // estimate would fight the decoder-backed duration channel and could flip a
    // published playlist total. Unknown stays 0 until hydration lands.
    durationSeconds: 0,
    fileExtension: fileExtension(descriptor.fileName),
    coverTone: coverToneForTrackId(descriptor.id),
    audioFormat: summaryAudioFormat(summary),
  }
}

export function pendingPlaylistTrackRow(
  descriptor: Pick<AudioFolderTrackRef, 'id' | 'fileName'>,
): PlaylistPendingTrackRow {
  return {
    id: descriptor.id,
    title: fileNameTitle(descriptor.fileName),
    artist: '',
    album: '',
  }
}

export function playlistTrackRowEqual(left: PlaylistTrackRow, right: PlaylistTrackRow): boolean {
  return left === right || (
    left.id === right.id
    && left.title === right.title
    && left.artist === right.artist
    && left.album === right.album
    && left.libraryAlbumName === right.libraryAlbumName
    && left.libraryArtistName === right.libraryArtistName
    && left.libraryComposerName === right.libraryComposerName
    && left.libraryYear === right.libraryYear
    && left.albumArtist === right.albumArtist
    && left.durationSeconds === right.durationSeconds
    && left.fileExtension === right.fileExtension
    && left.coverTone === right.coverTone
    && audioFormatEqual(left.audioFormat, right.audioFormat)
  )
}

function audioFormatEqual(left: Track['audioFormat'], right: Track['audioFormat']): boolean {
  return left === right || (
    left !== undefined
    && right !== undefined
    && left.bitDepth === right.bitDepth
    && left.sampleRateHz === right.sampleRateHz
    && left.bitrateKbps === right.bitrateKbps
    && left.codec === right.codec
  )
}

/**
 * Index identity of one playlist scope. Any change of the descriptor ids or
 * their source paths makes in-flight tag results unusable.
 */
export function playlistDescriptorFingerprint(
  descriptors: readonly Pick<AudioFolderTrackRef, 'id' | 'sourcePath'>[],
): string {
  return `${descriptors.length}\u0002${descriptors
    .map((descriptor) => `${descriptor.id}\u0001${normalizeAudioSourcePath(descriptor.sourcePath)}`)
    // Metadata belongs to id/path pairs, not their presentation order.
    // Reordering must keep the active pass and painted rows alive.
    .sort()
    .join('\u0000')}`
}

/**
 * Splits probes into the command's bounded batches, preserving request order and
 * de-duplicating repeated source paths (the response echoes one item per path).
 */
export function playlistSummaryProbePaths(
  descriptors: readonly Pick<AudioFolderTrackRef, 'id' | 'sourcePath' | 'available'>[],
): { paths: string[]; descriptorsByPath: Map<string, string[]> } {
  const paths: string[] = []
  const descriptorsByPath = new Map<string, string[]>()
  for (const descriptor of descriptors) {
    if (descriptor.available === false) continue
    const existing = descriptorsByPath.get(descriptor.sourcePath)
    if (existing) {
      existing.push(descriptor.id)
      continue
    }
    descriptorsByPath.set(descriptor.sourcePath, [descriptor.id])
    paths.push(descriptor.sourcePath)
  }
  return { paths, descriptorsByPath }
}

export function chunkPlaylistSummaryPaths(
  paths: readonly string[],
  batchSize: number,
): string[][] {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) return paths.length ? [[...paths]] : []
  const batches: string[][] = []
  for (let index = 0; index < paths.length; index += batchSize) {
    batches.push(paths.slice(index, index + batchSize))
  }
  return batches
}
