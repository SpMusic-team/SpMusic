import type { RefObject } from 'react'
import { LibraryListOptionsDialog } from './LibraryListOptionsDialog'
import { ALL_SONGS_SORT_OPTIONS, isAllSongsSingleLineLayout, type AllSongsSort } from '../model/allSongsListOptions'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
  finalFocus: RefObject<HTMLElement | null>
  sort: AllSongsSort
  onSortChange: (sort: AllSongsSort) => void
  descending: boolean
  onDescendingChange: (checked: boolean) => void
  titleOnly: boolean
  onTitleOnlyChange: (checked: boolean) => void
  layoutLevel: number
  onLayoutChange: (level: number) => void
}

export function AllSongsListOptionsDialog({
  sort, onSortChange, descending, onDescendingChange, titleOnly, onTitleOnlyChange, ...props
}: Props) {
  return <LibraryListOptionsDialog {...props} categoryLabel="所有歌曲"
    sort={{ options: ALL_SONGS_SORT_OPTIONS, value: sort, onChange: onSortChange, descending, onDescendingChange }}
    titleOnly={{ checked: titleOnly, onChange: onTitleOnlyChange, disabled: isAllSongsSingleLineLayout(props.layoutLevel) }} />
}
