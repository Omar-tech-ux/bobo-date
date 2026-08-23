import { useCallback, useEffect, useState } from 'react'
import {
  enableNotifications,
  getNotificationStatus,
} from './pushNotifications'
import type { NotificationSetupStatus } from './types'

const initialStatus: NotificationSetupStatus = {
  kind: 'permission-needed',
  message: 'Checking this device’s tiny mailbox…',
}

export function NotificationSetup({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const [status, setStatus] = useState(initialStatus)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getNotificationStatus())
    } catch {
      setStatus({
        kind: 'delivery-error',
        message: 'The device mailbox could not be checked. Try reconnecting it.',
      })
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const connect = async () => {
    setBusy(true)
    setNotice('')
    try {
      await enableNotifications(userId)
      await refreshStatus()
      setNotice('This device is ready for background love letters ♡')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Notifications got shy. Please try once more.')
      await refreshStatus()
    } finally {
      setBusy(false)
    }
  }

  const canConnect = status.kind === 'permission-needed' || status.kind === 'delivery-error'

  return (
    <section className={`notification-setup notification-setup--${status.kind}${compact ? ' notification-setup--compact' : ''}`} aria-label='Love-letter notification setup'>
      <div className='notification-bell' aria-hidden='true'>♩</div>
      <div className='notification-copy'>
        <h2>Date and anniversary alerts</h2>
        <p>{status.message}</p>
        {status.kind === 'installation-required' && (
          <ol>
            <li>Open this page in Safari.</li>
            <li>Tap Share, then Add to Home Screen.</li>
            <li>Open Bobo ♡ from its new icon.</li>
          </ol>
        )}
        {notice && <p className='notification-notice' role='status'>{notice}</p>}
      </div>
      {canConnect && (
        <div className='notification-actions'>
          <button className='pixel-button notification-action' type='button' disabled={busy} onClick={() => void connect()}>
            {busy ? 'CONNECTING…' : status.kind === 'delivery-error' ? 'RECONNECT THIS DEVICE' : 'TURN ON LOVE LETTERS'}
          </button>
        </div>
      )}
    </section>
  )
}
