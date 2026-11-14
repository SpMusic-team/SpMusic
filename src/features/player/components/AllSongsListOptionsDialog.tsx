import { useId, useRef, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { ALL_SONGS_SORT_OPTIONS, ALL_SONGS_VIEW_OPTIONS, type AllSongsSort } from '../model/allSongsListOptions'
import settings from '@/assets/all-songs-list-options/settings.svg'
import empty from '@/assets/all-songs-list-options/radio-empty.svg'
import selected from '@/assets/all-songs-list-options/radio-selected.svg'
import checkbox from '@/assets/all-songs-list-options/checkbox.svg'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
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

export function AllSongsListOptionsDialog(props: Props) {
  const id = useId()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const check = (label: string, checked: boolean, onChange: (checked: boolean) => void) => {
    const controlId = id + '-' + (label === '倒序' ? 'descending' : 'title-only')
    return <div className="all-songs-options-choice">
      <span className="all-songs-options-checkbox"><Checkbox id={controlId} checked={checked} onCheckedChange={onChange} /><img src={checkbox} alt="" aria-hidden="true" /></span><FieldLabel htmlFor={controlId}>{label}</FieldLabel>
    </div>
  }
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent className="all-songs-options-dialog" overlayClassName="folder-root-menu-overlay" showCloseButton={false} finalFocus={props.finalFocus} aria-describedby={undefined} initialFocus={scrollRef}>
      <header className="all-songs-options-header"><DialogTitle>列表选项：所有歌曲</DialogTitle><img src={settings} alt="" /></header>
      <div ref={scrollRef} className="all-songs-options-scroll" tabIndex={0}>
        <FieldSet className="all-songs-options-group"><FieldLegend>排序</FieldLegend>
          <div className="all-songs-options-choices">
            {ALL_SONGS_SORT_OPTIONS.map(option => <div key={option.value}>
              <label className="all-songs-options-choice" title={'unavailable' in option ? option.unavailable : undefined}>
                <span className="all-songs-options-radio"><input type="radio" name={id + '-sort'} value={option.value} checked={props.sort === option.value} disabled={'unavailable' in option} aria-describedby={'note' in option || 'unavailable' in option ? id + '-' + option.value : undefined} onChange={() => props.onSortChange(option.value)} /><img src={props.sort === option.value ? selected : empty} alt="" /></span><span>{option.label}</span>
              </label>
              {'note' in option || 'unavailable' in option ? <p id={id + '-' + option.value} className="all-songs-options-note">{'unavailable' in option ? option.unavailable : option.note}</p> : null}
            </div>)}
            {check('倒序', props.descending, props.onDescendingChange)}
          </div>
        </FieldSet>
        <FieldSet className="all-songs-options-group"><FieldLegend>布局</FieldLegend><div className="all-songs-options-choices">{check('仅显示标题', props.titleOnly, props.onTitleOnlyChange)}</div></FieldSet>
        <FieldSet className="all-songs-options-group"><FieldLegend>查看方式</FieldLegend><div className="all-songs-options-views">
          {ALL_SONGS_VIEW_OPTIONS.map((label, index) => <label key={label} className="all-songs-options-choice"><span className="all-songs-options-radio"><input type="radio" name={id + '-view'} value={9 - index} checked={props.layoutLevel === 9 - index} onChange={() => props.onLayoutChange(9 - index)} /><img src={props.layoutLevel === 9 - index ? selected : empty} alt="" /></span><span>{label}</span></label>)}
        </div></FieldSet>
      </div>
      <footer className="all-songs-options-footer"><Button variant="outline" onClick={() => props.onOpenChange(false)}>关闭</Button></footer>
    </DialogContent>
  </Dialog>
}
