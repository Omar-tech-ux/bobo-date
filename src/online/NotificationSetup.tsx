import { useCallback, useEffect, useState } from 'react'
import {
  enableNotifications,
  getNotificationStatus,
  sendTestNotification,
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

  const test = async () => {
    setBusy(true)
    setNotice('Sending a tiny test letter…')
    const result = await sendTestNotification()
    if (result.accepted > 0) {
      setNotice('Apple accepted this device’s test letter. Lock your phone for a moment and listen for the tiny tap ♡')
    } else if (result.reason === 'no-subscription') {
      setNotice('This device is not registered yet. Reconnect notifications, then try the test again.')
      await refreshStatus()
    } else if (result.reason === 'authentication') {
      setNotice('Your session needs refreshing. Sign out, sign back in, then try the test again.')
    } else if (result.reason === 'configuration' || result.reason === 'database') {
      setNotice('The notification service is temporarily unavailable. Please try again in a moment.')
    } else if (result.reason === 'invalid-request') {
      setNotice('This device sent an invalid test request. Reconnect notifications, then try once more.')
      await refreshStatus()
    } else {
      setNotice('Apple rejected this device’s mailbox address. Reconnect notifications and try again.')
    }
    setBusy(false)
  }

  const canConnect = status.kind === 'permission-needed' || status.kind === 'delivery-error'
  const canTest = status.kind === 'subscribed'

  return (
    <section className={`notification-setup notification-setup--${status.kind}${compact ? ' notification-setup--compact' : ''}`} aria-label='Date notification setup'>
      <div className='notification-bell' aria-hidden='true'>♩</div>
      <div className='notification-copy'>
        <h2>Date invitation alerts</h2>
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
      <div className='notification-actions'>
        {canConnect && (
          <button className='pixel-button notification-action' type='button' disabled={busy} onClick={() => void connect()}>
            {busy ? 'CONNECTING…' : status.kind === 'delivery-error' ? 'RECONNECT THIS DEVICE' : 'TURN ON LOVE LETTERS'}
          </button>
        )}
        {canTest && (
          <button className='text-link notification-test' type='button' disabled={busy} onClick={() => void test()}>
            {busy ? 'sending test…' : 'send me a test love letter'}
          </button>
        )}
      </div>
    </section>
  )
}
