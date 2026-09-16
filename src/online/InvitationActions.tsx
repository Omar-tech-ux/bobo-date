import { useId, useState } from 'react'
import { PixelDatePicker, PixelTimePicker } from '../components/PixelDateTimePickers'
import { createPlannedDateTime, getPlanTimes, getTimeZones, getTodayInZone, validatePlanTime } from '../dateTime'
import { useOnline } from './OnlineContext'
import { InvitationConflictError, canChangeInvitation, type DateInvitation } from './types'

export function InvitationActions({ invitation, cancelOnly = false, disabled = false, onEditing }: {
  invitation: DateInvitation
  cancelOnly?: boolean
  disabled?: boolean
  onEditing?: (editing: boolean) => void
}) {
  const { cancelInvitation, rescheduleInvitation } = useOnline()
  const [mode, setMode] = useState<'cancel' | 'reschedule' | null>(null)
  const [original, setOriginal] = useState(invitation)
  const [note, setNote] = useState('')
  const [date, setDate] = useState(invitation.date)
  const [time, setTime] = useState(invitation.time.slice(0, 5))
  const [zone, setZone] = useState(invitation.guest_timezone)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const errorId = useId()
  const active = canChangeInvitation(invitation)
  const preview = getPlanTimes({ date, time, guestTimeZone: zone })

  function close() {
    setMode(null)
    onEditing?.(false)
  }

  function open(next: 'cancel' | 'reschedule') {
    setOriginal(invitation)
    setDate(invitation.date)
    setTime(invitation.time.slice(0, 5))
    setZone(invitation.guest_timezone)
    setNote('')
    setError('')
    setMessage('')
    setMode(next)
    onEditing?.(true)
  }

  async function submit() {
    setError('')
    if (mode === 'reschedule') {
      const validation = validatePlanTime(date, time, zone)
      const nextTime = createPlannedDateTime(date, time, zone)
      const oldTime = createPlannedDateTime(original.date, original.time, original.guest_timezone)
      if (validation || nextTime?.toMillis() === oldTime?.toMillis()) {
        setError(validation || 'Please choose a different time for your date.')
        return
      }
    }
    setBusy(true)
    try {
      const result = mode === 'cancel'
        ? await cancelInvitation(original, note)
        : await rescheduleInvitation(original, { date, time, guestTimeZone: zone })
      const saved = mode === 'cancel' ? 'Your date was canceled ♡' : 'New time proposed. Waiting for your person’s answer ♡'
      setMessage(result.accepted > 0 ? saved : `${saved} The ticket updated, but the background tap could not reach their phone.`)
      close()
    } catch (failure) {
      if (failure instanceof InvitationConflictError) {
        close()
        setMessage(failure.message)
        return
      }
      setError(failure instanceof Error ? failure.message : 'The ticket could not be updated. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className='invitation-actions'>
    {active && !mode && <div className='response-actions'>
      {!cancelOnly && <button className='pixel-button reschedule-invite' disabled={disabled} onClick={() => open('reschedule')}>Reschedule</button>}
      <button className='text-link decline-invite' disabled={disabled} onClick={() => open('cancel')}>Cancel date</button>
    </div>}
    {mode && <form className='invitation-edit-form' onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <fieldset disabled={busy || disabled || !active}>
        <legend>{mode === 'cancel' ? 'Cancel this date?' : 'Choose a new time'}</legend>
        {mode === 'cancel' ? <>
          <p>Your person will receive a little notification. This ticket will stay in your mailbox.</p>
          <label>Add a tiny note (optional)
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={240} />
          </label>
        </> : <>
          <div className='date-row'>
            <PixelDatePicker value={date} min={getTodayInZone(zone)} onChange={setDate} invalid={Boolean(error)} describedBy={error ? errorId : undefined} />
            <PixelTimePicker value={time} onChange={setTime} invalid={Boolean(error)} describedBy={error ? errorId : undefined} />
          </div>
          <label>Timezone
            <select value={zone} onChange={(event) => setZone(event.target.value)}>
              {getTimeZones(zone).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
          {preview && <div className='reschedule-preview'><p>Chosen time: {preview.guest}</p><p>Amman time: {preview.host}</p></div>}
          <p>Your person will need to accept this new time.</p>
        </>}
        <button type='submit' className='pixel-button' disabled={busy || disabled || !active}>
          {busy ? 'Saving…' : mode === 'cancel' ? 'Yes, cancel date' : 'Propose new time'}
        </button>
      </fieldset>
      <button type='button' className='text-link' disabled={busy} onClick={close}>{mode === 'cancel' ? 'Keep date' : 'Keep current time'}</button>
      {!active && <p role='status'>This ticket has been closed.</p>}
      {error && <p id={errorId} className='mailbox-message' role='alert'>{error}</p>}
    </form>}
    {message && <p className='mailbox-message' role='status'>{message}</p>}
  </div>
}
