import songs from '@/assets/playlist-library/2705a.svg'
import folder from '@/assets/playlist-library/39148.svg'
import folders from '@/assets/playlist-library/eadad.svg'
import album from '@/assets/playlist-library/4c15f.svg'
import artist from '@/assets/playlist-library/65239.svg'
import albumArtist from '@/assets/playlist-library/7b1e7.svg'
import genre from '@/assets/playlist-library/371cc.svg'
import year from '@/assets/playlist-library/8993f.svg'
import composer from '@/assets/playlist-library/07ce2.svg'
import playlists from '@/assets/playlist-library/84ec1.svg'
import streams from '@/assets/playlist-library/5eeee.svg'
import queue from '@/assets/playlist-library/19c02.svg'
import bookmarks from '@/assets/playlist-library/e2f96.svg'
import mostPlayed from '@/assets/playlist-library/be8c7.svg'
import highestRated from '@/assets/playlist-library/196c7.svg'
import lowestRated from '@/assets/playlist-library/602f9.svg'
import recentPlayed from '@/assets/playlist-library/02e4a.svg'
import recentAdded from '@/assets/playlist-library/4b586.svg'
import longTracks from '@/assets/playlist-library/d3da6.svg'

import overview0 from '@/assets/media-library/b0f4f.svg'
import overview1 from '@/assets/media-library/71c3e.svg'
import overview2 from '@/assets/media-library/ac156.svg'
import overview3 from '@/assets/media-library/bdfc0.svg'
import overview4 from '@/assets/media-library/feb56.svg'
import overview5 from '@/assets/media-library/09ad8.svg'
import overview6 from '@/assets/media-library/b6cb4.svg'
import overview7 from '@/assets/media-library/40b2a.svg'
import overview8 from '@/assets/media-library/80c3a.svg'
import overview9 from '@/assets/playlist-library/dc9e8.svg'
import overview10 from '@/assets/media-library/1acd5.svg'
import overview11 from '@/assets/media-library/8e7f7.svg'
import overview12 from '@/assets/media-library/01c3e.svg'
import overview13 from '@/assets/media-library/a608b.svg'
import overview14 from '@/assets/media-library/31d62.svg'
import overview15 from '@/assets/media-library/fb051.svg'
import overview16 from '@/assets/media-library/6f6b6.svg'
import overview17 from '@/assets/media-library/30267.svg'
import overview18 from '@/assets/media-library/18e82.svg'

export const mediaLibraryCategories = [
  { id: 'songs', label: '所有歌曲', icon: songs, overviewIcon: overview0, glyphWidth: 48, glyphHeight: 48 },
  { id: 'folder', label: '文件夹', icon: folder, overviewIcon: overview1, glyphWidth: 48, glyphHeight: 48 },
  { id: 'folders', label: '文件夹层次结构', icon: folders, overviewIcon: overview2, glyphWidth: 48, glyphHeight: 48 },
  { id: 'album', label: '专辑', icon: album, overviewIcon: overview3, glyphWidth: 48, glyphHeight: 48 },
  { id: 'artist', label: '艺术家', icon: artist, overviewIcon: overview4, glyphWidth: 48, glyphHeight: 48 },
  { id: 'album-artist', label: '专辑艺术家', icon: albumArtist, overviewIcon: overview5, glyphWidth: 48, glyphHeight: 48 },
  { id: 'genre', label: '流派', icon: genre, overviewIcon: overview6, glyphWidth: 48, glyphHeight: 48 },
  { id: 'year', label: '年份', icon: year, overviewIcon: overview7, glyphWidth: 28, glyphHeight: 28 },
  { id: 'composer', label: '作曲家', icon: composer, overviewIcon: overview8, glyphWidth: 48, glyphHeight: 48 },
  { id: 'playlists', label: '播放列表', icon: playlists, overviewIcon: overview9, glyphWidth: 49, glyphHeight: 48 },
  { id: 'streams', label: '流', icon: streams, overviewIcon: overview10, glyphWidth: 48, glyphHeight: 48 },
  { id: 'queue', label: '队列', icon: queue, overviewIcon: overview11, glyphWidth: 48, glyphHeight: 56.571 },
  { id: 'bookmarks', label: '书签', icon: bookmarks, overviewIcon: overview12, glyphWidth: 48, glyphHeight: 48 },
  { id: 'most-played', label: '最常播放', icon: mostPlayed, overviewIcon: overview13, glyphWidth: 48, glyphHeight: 57 },
  { id: 'highest-rated', label: '最高评级', icon: highestRated, overviewIcon: overview14, glyphWidth: 48, glyphHeight: 48 },
  { id: 'lowest-rated', label: '最低评级', icon: lowestRated, overviewIcon: overview15, glyphWidth: 48, glyphHeight: 48 },
  { id: 'recent-played', label: '最近播放', icon: recentPlayed, overviewIcon: overview16, glyphWidth: 48, glyphHeight: 57 },
  { id: 'recent-added', label: '最近添加', icon: recentAdded, overviewIcon: overview17, glyphWidth: 48, glyphHeight: 48 },
  { id: 'long-tracks', label: '长', icon: longTracks, overviewIcon: overview18, glyphWidth: 48, glyphHeight: 48 },
] as const

export type MediaLibraryCategoryId = typeof mediaLibraryCategories[number]['id']
export type MediaLibraryRoute = { view: 'overview' } | { view: 'category'; categoryId: MediaLibraryCategoryId } | { view: 'tracks' }
