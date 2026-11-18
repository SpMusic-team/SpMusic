import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Slider } from '@/components/ui/slider'
import { ALL_SONGS_VIEW_OPTIONS } from '../model/allSongsListOptions'
import settings from '@/assets/all-songs-list-options/settings.svg'
import empty from '@/assets/all-songs-list-options/radio-empty.svg'
import selected from '@/assets/all-songs-list-options/radio-selected.svg'
import checkbox from '@/assets/all-songs-list-options/checkbox.svg'
import errorCircle from '@/assets/all-songs-list-options/error-circle.svg'

type Props<Sort extends string> = {
  categoryLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
  finalFocus: RefObject<HTMLElement | null>
  sort?: {
    options: readonly { value: Sort; label: string; note?: string }[]
    value: Sort
    onChange: (value: Sort) => void
    descending: boolean
    onDescendingChange: (checked: boolean) => void
  }
  titleOnly?: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }
  limit?: { value: number; onChange: (value: number) => void }
  duration?: { value: number; max: number; step: number; onChange: (value: number) => void; format: (value: number) => string }
  layoutLevel: number
  onLayoutChange: (level: number) => void
}

const LIMITS = [200, 500, 1000, Number.MAX_SAFE_INTEGER]

type OptionRadioProps = {
  name: string
  value: string | number
  label: string
  checked: boolean
  descriptionId?: string
  onChange: () => void
}

function OptionRadio({ name, value, label, checked, descriptionId, onChange }: OptionRadioProps) {
  return (
    <label className="all-songs-options-choice">
      <span className="all-songs-options-radio">
        <input type="radio" name={name} value={value} checked={checked} aria-describedby={descriptionId} onChange={onChange} />
        <img src={checked ? selected : empty} alt="" />
      </span>
      <span>{label}</span>
    </label>
  )
}

function DurationOption({ value, max, step, onChange, format }: NonNullable<Props<string>['duration']>) {
  const [preview, setPreview] = useState<number>()
  const displayed = preview ?? value
  return (
    <FieldSet className="all-songs-options-group all-songs-options-duration">
      <FieldLegend>最短持续时间</FieldLegend>
      <output className="all-songs-options-duration-value">{format(displayed)}</output>
      <Slider className="all-songs-options-duration-slider" getAriaLabel={() => '最短持续时间'}
        getAriaValueText={(_formatted, current) => format(current)} value={displayed}
        min={value === 0 ? 0 : step} max={Math.max(max, value)} step={step}
        onValueChange={next => { if (typeof next === 'number') setPreview(next) }}
        onValueCommitted={next => {
          if (typeof next !== 'number') return
          setPreview(undefined)
          onChange(next)
        }} />
    </FieldSet>
  )
}

export function LibraryListOptionsDialog<Sort extends string>(props: Props<Sort>) {
  const { sort, titleOnly, limit, duration } = props
  const id = useId()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const settingsHandoff = useRef(false)
  const descendingId = `${id}-descending`
  const titleOnlyId = `${id}-title-only`
  const viewHintId = `${id}-view-hint`

  useEffect(() => {
    if (props.open) settingsHandoff.current = false
  }, [props.open])

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="all-songs-options-dialog"
        data-size-to-content={props.categoryLabel !== '所有歌曲' || undefined}
        overlayClassName="folder-root-menu-overlay"
        showCloseButton={false}
        finalFocus={() => settingsHandoff.current ? false : props.finalFocus.current}
        aria-describedby={undefined}
        initialFocus={scrollRef}
      >
        <header className="all-songs-options-header">
          <DialogTitle>列表选项：{props.categoryLabel}</DialogTitle>
          <Button variant="ghost" size="icon" aria-label="媒体库设置" onClick={() => {
            settingsHandoff.current = true
            props.onOpenSettings()
          }}>
            <img src={settings} alt="" />
          </Button>
        </header>
        <div ref={scrollRef} className="all-songs-options-scroll" tabIndex={0}>
          {duration && <DurationOption {...duration} />}
          {limit && <FieldSet className="all-songs-options-group">
            <FieldLegend>最大项目</FieldLegend>
            <div className="all-songs-options-views">
              {LIMITS.map(value => <OptionRadio key={value} name={id + '-limit'} value={value}
                label={value === Number.MAX_SAFE_INTEGER ? '无限制' : String(value)} checked={limit.value === value}
                onChange={() => limit.onChange(value)} />)}
            </div>
          </FieldSet>}
          {sort && <FieldSet className="all-songs-options-group">
            <FieldLegend>排序</FieldLegend>
            <div className="all-songs-options-choices">
              {sort.options.map(option => {
                const noteId = option.note ? `${id}-${option.value}` : undefined
                return (
                  <div key={option.value}>
                    <OptionRadio name={`${id}-sort`} value={option.value} label={option.label} checked={sort.value === option.value} descriptionId={noteId} onChange={() => sort.onChange(option.value)} />
                    {option.note && <p id={noteId} className="all-songs-options-note">{option.note}</p>}
                  </div>
                )
              })}
              <div className="all-songs-options-choice">
                <span className="all-songs-options-checkbox">
                  <Checkbox id={descendingId} checked={sort.descending} onCheckedChange={sort.onDescendingChange} />
                  <img src={checkbox} alt="" />
                </span>
                <FieldLabel htmlFor={descendingId}>倒序</FieldLabel>
              </div>
            </div>
          </FieldSet>}
          {titleOnly && <FieldSet className="all-songs-options-group">
            <FieldLegend>布局</FieldLegend>
            <div className="all-songs-options-choices">
              <div className="all-songs-options-choice">
                <span className="all-songs-options-checkbox">
                  <Checkbox id={titleOnlyId} checked={titleOnly.checked} disabled={titleOnly.disabled} onCheckedChange={titleOnly.onChange} />
                  <img src={checkbox} alt="" />
                </span>
                <FieldLabel htmlFor={titleOnlyId}>仅显示标题</FieldLabel>
              </div>
            </div>
          </FieldSet>}
          <FieldSet className="all-songs-options-group" aria-describedby={viewHintId}>
            <FieldLegend>查看方式</FieldLegend>
            <p id={viewHintId} className="all-songs-options-view-hint">
              <img src={errorCircle} alt="" />
              可使用双指缩放切换
            </p>
            <div className="all-songs-options-views">
              {ALL_SONGS_VIEW_OPTIONS.map((label, index) => {
                const level = 9 - index
                return <OptionRadio key={label} name={`${id}-view`} value={level} label={label} checked={props.layoutLevel === level} onChange={() => props.onLayoutChange(level)} />
              })}
            </div>
          </FieldSet>
        </div>
        <footer className="all-songs-options-footer">
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>关闭</Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
