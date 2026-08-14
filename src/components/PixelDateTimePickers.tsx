import { useEffect, useId, useMemo, useRef, useState } from 'react'

type PickerProps = {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
}

type DatePickerProps = PickerProps & {
  min: string
}

const weekDays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const result = new Date(year, month - 1, day)
  return Number.isNaN(result.getTime()) ? null : result
}

function toDateValue(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function prettyDate(value: string) {
  const date = parseDate(value)
  if (!date) return 'Pick our day ♡'
  return new Intl.DateTimeFormat('en', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  }).format(date)
}

function nextSaturday(minimum: Date) {
  const result = new Date(minimum)
  const distance = (6 - result.getDay() + 7) % 7 || 7
  result.setDate(result.getDate() + distance)
  return result
}

function useClosePicker(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return ref
}

export function PixelDatePicker({ value, onChange, min, invalid, describedBy }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const initial = parseDate(value) ?? parseDate(min) ?? new Date()
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  )
  const labelId = useId()
  const close = () => setOpen(false)
  const pickerRef = useClosePicker(open, close)
  const minimum = parseDate(min) ?? new Date()

  const calendarDays = useMemo(() => {
    const year = visibleMonth.getFullYear()
    const month = visibleMonth.getMonth()
    const leading = new Date(year, month, 1).getDay()
    const count = new Date(year, month + 1, 0).getDate()
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: count }, (_, index) => new Date(year, month, index + 1)),
    ]
  }, [visibleMonth])

  const selectDate = (date: Date) => {
    onChange(toDateValue(date))
    close()
  }

  return (
    <div className='pixel-picker-field' ref={pickerRef}>
      <span className='picker-label' id={labelId}>The day</span>
      <input type='hidden' name='date' value={value} onChange={(event) => onChange(event.target.value)} />
      <button
        className='picker-trigger'
        type='button'
        aria-labelledby={labelId}
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{prettyDate(value)}</span>
        <i className='calendar-icon' aria-hidden='true'><b>♥</b></i>
      </button>

      {open && (
        <div className='pixel-picker-popover calendar-popover' role='dialog' aria-label='Choose our date'>
          <div className='calendar-header'>
            <button type='button' aria-label='Previous month' onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}>←</button>
            <strong>{months[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}</strong>
            <button type='button' aria-label='Next month' onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}>→</button>
          </div>
          <div className='calendar-weekdays' aria-hidden='true'>
            {weekDays.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className='calendar-days'>
            {calendarDays.map((date, index) => {
              if (!date) return <span className='empty-day' key={`empty-${index}`} />
              const dateValue = toDateValue(date)
              const disabled = date < minimum
              const selected = value === dateValue
              return (
                <button
                  type='button'
                  key={dateValue}
                  disabled={disabled}
                  className={selected ? 'selected-day' : undefined}
                  aria-label={new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)}
                  aria-pressed={selected}
                  onClick={() => selectDate(date)}
                >
                  {date.getDate()}{selected && <i aria-hidden='true'>♥</i>}
                </button>
              )
            })}
          </div>
          <button className='picker-shortcut' type='button' onClick={() => selectDate(nextSaturday(minimum))}>
            NEXT SATURDAY ♡
          </button>
        </div>
      )}
    </div>
  )
}

function parseTime(value: string) {
  const [rawHour, rawMinute] = value.split(':').map(Number)
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) {
    return { hour: 7, minute: 0, period: 'PM' as const }
  }
  return {
    hour: rawHour % 12 || 12,
    minute: rawMinute,
    period: (rawHour >= 12 ? 'PM' : 'AM') as 'AM' | 'PM',
  }
}

function toTimeValue(hour: number, minute: number, period: 'AM' | 'PM') {
  const hour24 = period === 'PM' ? (hour % 12) + 12 : hour % 12
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function prettyTime(value: string) {
  if (!value) return 'Pick our time ♡'
  const { hour, minute, period } = parseTime(value)
  return `${hour}:${String(minute).padStart(2, '0')} ${period}`
}

export function PixelTimePicker({ value, onChange, invalid, describedBy }: PickerProps) {
  const [open, setOpen] = useState(false)
  const initial = parseTime(value)
  const [hour, setHour] = useState(initial.hour)
  const [minute, setMinute] = useState(initial.minute)
  const [period, setPeriod] = useState<'AM' | 'PM'>(initial.period)
  const labelId = useId()
  const close = () => setOpen(false)
  const pickerRef = useClosePicker(open, close)

  useEffect(() => {
    if (!open) return
    const parsed = parseTime(value)
    setHour(parsed.hour)
    setMinute(parsed.minute)
    setPeriod(parsed.period)
  }, [open, value])

  const confirm = () => {
    onChange(toTimeValue(hour, minute, period))
    close()
  }

  return (
    <div className='pixel-picker-field' ref={pickerRef}>
      <span className='picker-label' id={labelId}>Your time</span>
      <input type='hidden' name='time' value={value} onChange={(event) => onChange(event.target.value)} />
      <button
        className='picker-trigger'
        type='button'
        aria-labelledby={labelId}
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{prettyTime(value)}</span>
        <i className='clock-icon' aria-hidden='true'><b /></i>
      </button>

      {open && (
        <div className='pixel-picker-popover time-popover' role='dialog' aria-label='Choose our time'>
          <p className='time-picker-title'>WHEN SHOULD I BE READY? ♡</p>
          <div className='time-readout' aria-live='polite'>
            <span>{hour}</span><b>:</b><span>{String(minute).padStart(2, '0')}</span><em>{period}</em>
          </div>
          <p className='picker-section-label'>HOUR</p>
          <div className='hour-grid'>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((option) => (
              <button type='button' key={option} className={hour === option ? 'active-time' : undefined} onClick={() => setHour(option)}>{option}</button>
            ))}
          </div>
          <div className='minute-period-row'>
            <div>
              <p className='picker-section-label'>MINUTES</p>
              <div className='minute-grid'>
                {[0, 15, 30, 45].map((option) => (
                  <button type='button' key={option} className={minute === option ? 'active-time' : undefined} onClick={() => setMinute(option)}>{String(option).padStart(2, '0')}</button>
                ))}
              </div>
            </div>
            <div>
              <p className='picker-section-label'>SUN OR MOON?</p>
              <div className='period-grid'>
                <button type='button' className={period === 'AM' ? 'active-time' : undefined} onClick={() => setPeriod('AM')}>☀ AM</button>
                <button type='button' className={period === 'PM' ? 'active-time' : undefined} onClick={() => setPeriod('PM')}>☾ PM</button>
              </div>
            </div>
          </div>
          <button className='picker-confirm' type='button' onClick={confirm}>SET OUR TIME ♥</button>
        </div>
      )}
    </div>
  )
}
