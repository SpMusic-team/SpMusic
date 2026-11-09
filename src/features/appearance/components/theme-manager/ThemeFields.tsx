import { useState } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { hexColorPattern } from '../../model/themeDraft'

type Option = { label: string; value: string }

function colorPickerValue(value: string) {
  return /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000'
}

function colorWithPreservedAlpha(previous: string, rgb: string) {
  return hexColorPattern.test(previous) && previous.length === 9
    ? `${rgb}${previous.slice(7)}`
    : rgb
}

type ColorFieldProps = {
  id: string
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  onPickerChange: (value: string) => void
}

export function ColorField({ id, label, description, value, onChange, onPickerChange }: ColorFieldProps) {
  const [localValue, setLocalValue] = useState(value)
  const [lastExternalValue, setLastExternalValue] = useState(value)
  if (value !== lastExternalValue) {
    setLastExternalValue(value)
    setLocalValue(value)
  }

  const valid = hexColorPattern.test(localValue)
  return (
    <Field data-invalid={!valid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          aria-invalid={!valid}
          value={localValue}
          onChange={(event) => {
            setLocalValue(event.target.value)
            onChange(event.target.value)
          }}
        />
        <Input
          className="size-8 shrink-0 cursor-pointer p-0.5"
          type="color"
          aria-label={`${label}取色器`}
          value={colorPickerValue(localValue)}
          onChange={(event) => {
            const next = colorWithPreservedAlpha(localValue, event.target.value)
            setLocalValue(next)
            onPickerChange(next)
          }}
        />
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

type OptionFieldProps = {
  id: string
  label: string
  description?: string
  disabled?: boolean
  value: string
  options: readonly Option[]
  onChange: (value: string) => void
}

export function OptionField({ id, label, description, disabled = false, value, options, onChange }: OptionFieldProps) {
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select disabled={disabled} items={options} value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

type SliderFieldProps = {
  id: string
  label: string
  description: string
  disabled?: boolean
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}

export function SliderField({
  id,
  label,
  description,
  disabled = false,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '%',
  onChange,
}: SliderFieldProps) {
  function commitValue(candidate: number) {
    if (!Number.isFinite(candidate)) return
    onChange(Math.min(max, Math.max(min, candidate)))
  }

  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={`${id}-value`}>{label}</FieldLabel>
      <div className="flex items-center gap-3">
        <Slider
          id={id}
          disabled={disabled}
          getAriaLabel={() => label}
          getAriaValueText={(_, nextValue) => `${nextValue}${unit}`}
          max={max}
          min={min}
          step={step}
          value={[value]}
          onValueChange={(nextValue) => commitValue(Array.isArray(nextValue) ? (nextValue[0] ?? min) : nextValue)}
        />
        <div className="flex w-24 shrink-0 items-center gap-1">
          <Input
            id={`${id}-value`}
            aria-label={`${label}数值`}
            disabled={disabled}
            inputMode="decimal"
            max={max}
            min={min}
            step={step}
            type="number"
            value={value}
            onChange={(event) => commitValue(Number(event.target.value))}
          />
          <span className="text-sm text-muted-foreground" aria-hidden="true">{unit}</span>
        </div>
      </div>
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )
}
