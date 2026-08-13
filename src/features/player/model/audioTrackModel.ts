import { splitLyricTranslation } from '@/features/player/model/lyrics'
import type { DemoLyricLine, Track } from '@/features/player/model/playerTypes'
import {
  audioCoverArtFallbackUrl,
  audioCoverArtUrl,
  type AudioFolderTrackRef,
  type AudioFolderPlaylist,
  type AudioTrackRef,
} from '@/features/player/services/audioCommands'

function nonEmptyText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

export function fileNameTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, '') || fileName
}

export function playlistDisplayName(playlist: AudioFolderPlaylist): string {
  return playlist.sourceKind === 'm3u8' ? playlist.sourceName : playlist.directoryName
}

export function singleTrackFolderPlaylist(track: AudioTrackRef): AudioFolderPlaylist {
  const normalizedPath = track.sourcePath.replaceAll('\\', '/')
  const lastSlash = normalizedPath.lastIndexOf('/')
  const directoryPath = lastSlash >= 0 ? normalizedPath.slice(0, lastSlash) : ''
  const directoryName = directoryPath.split('/').filter(Boolean).at(-1) ?? '本地音频'

  return {
    directoryPath,
    directoryName,
    sourceKind: 'folder',
    sourcePath: directoryPath,
    sourceName: directoryName,
    selectedIndex: 0,
    tracks: [{
      id: track.id,
      sourcePath: track.sourcePath,
      fileName: track.fileName,
      available: true,
    }],
  }
}

export function audioFolderTrackPlaceholder(track: AudioFolderTrackRef): AudioTrackRef {
  return {
    id: track.id,
    sourcePath: track.sourcePath,
    fileName: track.fileName,
    durationMs: null,
    metadata: {
      title: null,
      artist: null,
      album: null,
      albumArtist: null,
      genre: null,
      year: null,
      trackNumber: null,
      discNumber: null,
      comment: null,
      lyrics: null,
      coverArt: null,
    },
  }
}

function parseLyricTimestamp(timestamp: string): number {
  const [minutes = '0', seconds = '0'] = timestamp.split(':')
  return Number(minutes) * 60 + Number(seconds)
}

function metadataLyricsToLines(track: AudioTrackRef, durationSeconds: number): DemoLyricLine[] {
  const source = track.metadata.lyrics?.trim()
  if (!source) return []

  const synced: DemoLyricLine[] = []
  const plain: string[] = []

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line) continue

    const timestamps = [...line.matchAll(/\[(\d{1,3}:\d{2}(?:\.\d{1,3})?)\]/gu)]
    const text = line.replace(/\[(?:\d{1,3}:\d{2}(?:\.\d{1,3})?|[^\]]+):[^\]]*\]/gu, '').trim()
    if (!text) continue

    if (!timestamps.length) {
      plain.push(text)
      continue
    }

    for (const timestamp of timestamps) {
      const timeSeconds = parseLyricTimestamp(timestamp[1])
      const split = splitLyricTranslation(text)
      synced.push({
        id: `${track.id}-${timeSeconds}-${synced.length}`,
        timeSeconds,
        original: split.original,
        translation: split.translation,
      })
    }
  }

  if (synced.length) return synced.sort((left, right) => left.timeSeconds - right.timeSeconds)

  return plain.map((text, index) => {
    const split = splitLyricTranslation(text)
    return {
      id: `${track.id}-plain-${index}`,
      timeSeconds: plain.length > 1 ? durationSeconds * index / plain.length : 0,
      original: split.original,
      translation: split.translation,
    }
  })
}

export function audioTrackToTrack(track: AudioTrackRef): Track {
  const durationSeconds = track.durationMs ? track.durationMs / 1000 : 0
  const title = nonEmptyText(track.metadata.title) ?? fileNameTitle(track.fileName)
  const artist = nonEmptyText(track.metadata.artist) ?? nonEmptyText(track.metadata.albumArtist) ?? '本地音频'
  const album = nonEmptyText(track.metadata.album) ?? '本地音频'

  return {
    id: track.id,
    title,
    artist,
    album,
    category: 'local-audio',
    durationSeconds,
    coverTone: 'blue',
    coverImage: audioCoverArtUrl(track.metadata.coverArt),
    coverImageFallback: audioCoverArtFallbackUrl(track.metadata.coverArt),
    lyrics: metadataLyricsToLines(track, durationSeconds),
  }
}

export function upsertTrack(tracks: Track[], track: AudioTrackRef, durationMs?: number | null): Track[] {
  const localTrack = audioTrackToTrack({
    ...track,
    durationMs: durationMs ?? track.durationMs,
  })

  return tracks.some((item) => item.id === localTrack.id)
    ? tracks.map((item) => item.id === localTrack.id ? localTrack : item)
    : [localTrack, ...tracks]
}
