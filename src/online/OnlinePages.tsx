import { type FormEvent, useMemo, useState } from 'react'
import { getPlanTimes } from '../dateTime'
import { activities } from '../types'
import { enableNotifications } from './pushNotifications'
import { getAppUrl, supabase } from './supabase'
import { useOnline } from './OnlineContext'
import type { DateInvitation, InvitationStatus } from './types'

function goTo(route: string) {
  window.location.hash = route
}

function AuthForm() {
  const { refresh } = useOnline()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        await refresh()
        goTo('/inbox')
      } else {
        const cleanUsername = username.trim().toLowerCase()
        if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
          throw new Error('Your tiny username needs 3–20 letters, numbers, or underscores.')
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName.trim(), username: cleanUsername },
            emailRedirectTo: getAppUrl('/account'),
          },
        })
        if (error) throw error
        if (data.session) {
          await refresh()
          goTo('/pair')
        } else {
          setMessage('A confirmation letter is waiting in your email ♡ Open it, then come back here to sign in.')
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The mailbox got shy. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className='love-auth'>
      <div className='auth-tabs' role='tablist' aria-label='Account options'>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'signin'}
          onClick={() => { setMode('signin'); setMessage('') }}
        >
          I HAVE AN ACCOUNT
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={mode === 'signup'}
          onClick={() => { setMode('signup'); setMessage('') }}
        >
          MAKE MY ACCOUNT
        </button>
      </div>

      <form onSubmit={submit} className='love-auth-form'>
        {mode === 'signup' && (
          <>
            <label>
              What should your person call you?
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete='name'
                required
                maxLength={40}
                placeholder='Bobo'
              />
            </label>
            <label>
              Your tiny username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete='username'
                required
                maxLength={20}
                placeholder='bobo'
              />
            </label>
          </>
        )}
        <label>
          Email
          <input
            type='email'
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete='email'
            required
            placeholder='your@email.com'
          />
        </label>
        <label>
          Secret password
          <input
            type='password'
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={8}
            required
            placeholder='at least 8 characters'
          />
        </label>
        {message && <p className='mailbox-message' role='status'>{message}</p>}
        <button className='pixel-button mailbox-submit' data-sound='confirm' disabled={busy}>
          {busy ? 'SENDING A TINY LETTER…' : mode === 'signin' ? 'OPEN OUR MAILBOX ♥' : 'CREATE MY ACCOUNT ♥'}
        </button>
      </form>
    </section>
  )
}

export function AccountPage() {
  const { configured, loading, user, profile, pairing, signOut } = useOnline()
  const [notice, setNotice] = useState('')

  if (!configured) return <OnlineSetupNotice />

  return (
    <main className='online-screen'>
      <div className='mailbox-sky' aria-hidden='true'><i>♥</i><i>✦</i><i>♥</i></div>
      <section className='mailbox-paper'>
        <div className='mailbox-mark' aria-hidden='true'>✉</div>
        <h1>Our little love mailbox</h1>
        <p className='mailbox-intro'>Only two people belong here: you and your person.</p>

        {loading ? (
          <p className='mailbox-loading'>Checking for tiny letters…</p>
        ) : !user ? (
          <AuthForm />
        ) : (
          <div className='account-home'>
            <p className='hello-person'>Hi, {profile?.display_name ?? 'cutie'} ♡</p>
            <p className='account-username'>@{profile?.username ?? 'setting-up'}</p>

            {pairing.partner ? (
              <div className='paired-note'>
                <span aria-hidden='true'>♥ ··· ♥</span>
                <p>You’re connected with <strong>{pairing.partner.display_name}</strong> (@{pairing.partner.username}).</p>
              </div>
            ) : (
              <div className='unpaired-note'>
                <p>Your person hasn’t joined this mailbox yet.</p>
                <a href='#/pair' className='pixel-button link-button'>PAIR OUR ACCOUNTS</a>
              </div>
            )}

            <div className='account-actions'>
              <a href='#/inbox' className='pixel-button link-button'>SEE OUR INVITATIONS</a>
              <button
                type='button'
                className='text-link notification-link'
                onClick={async () => {
                  try {
                    const result = await enableNotifications(user.id)
                    setNotice(result.backgroundPushReady
                      ? 'Notifications are ready—even when the app is tucked away ♡'
                      : 'Live notifications are ready while the app is open. Background delivery is the last setup step ♡')
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : 'Notifications got shy.')
                  }
                }}
              >
                turn on date notifications
              </button>
              <button type='button' className='text-link signout-link' onClick={() => void signOut()}>
                sign out of this device
              </button>
            </div>
            {notice && <p className='mailbox-message' role='status'>{notice}</p>}
          </div>
        )}
        <a className='mailbox-home-link' href='#/'>← back to our pink sky</a>
      </section>
    </main>
  )
}

export function PairingPage() {
  const { configured, loading, user, profile, pairing, createPairCode, joinPairCode } = useOnline()
  const [code, setCode] = useState('')
  const [createdCode, setCreatedCode] = useState(pairing.code ?? '')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  if (!configured) return <OnlineSetupNotice />
  if (!loading && !user) return <AccountPage />

  const makeCode = async () => {
    setBusy(true)
    setMessage('')
    try {
      setCreatedCode(await createPairCode())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The code got lost in the clouds.')
    } finally {
      setBusy(false)
    }
  }

  const join = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await joinPairCode(code)
      goTo('/inbox')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'That code did not find its person.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className='online-screen pairing-screen'>
      <section className='mailbox-paper pairing-paper'>
        <div className='pair-cats' aria-hidden='true'>/ᐠ｡ꞈ｡ᐟ\ &nbsp; ♥ &nbsp; /ᐠ｡ꞈ｡ᐟ\</div>
        <h1>Connect just the two of us</h1>
        {pairing.partner ? (
          <div className='paired-complete'>
            <p>{profile?.display_name} + {pairing.partner.display_name}</p>
            <strong>Two accounts, one tiny world ♡</strong>
            <a href='#/plan' className='pixel-button link-button'>SEND A DATE INVITATION</a>
          </div>
        ) : (
          <div className='pairing-options'>
            <section>
              <h2>I’ll make our code</h2>
              <p>Send this one-time code privately to your person.</p>
              {createdCode ? (
                <button
                  className='pair-code'
                  type='button'
                  onClick={() => void navigator.clipboard?.writeText(createdCode)}
                  aria-label={`Copy pairing code ${createdCode}`}
                >
                  {createdCode}
                  <span>tap to copy</span>
                </button>
              ) : (
                <button className='pixel-button' type='button' disabled={busy} onClick={() => void makeCode()}>
                  MAKE OUR CODE
                </button>
              )}
            </section>
            <div className='pair-divider' aria-hidden='true'>or</div>
            <section>
              <h2>I have their code</h2>
              <p>Enter the six letters they sent you.</p>
              <form onSubmit={join} className='join-code-form'>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  required
                  minLength={6}
                  maxLength={6}
                  autoComplete='one-time-code'
                  aria-label='Pairing code'
                  placeholder='BOBO42'
                />
                <button className='pixel-button' disabled={busy}>JOIN MY PERSON</button>
              </form>
            </section>
          </div>
        )}
        {message && <p className='mailbox-message' role='alert'>{message}</p>}
        <a href='#/account' className='mailbox-home-link'>← back to my account</a>
      </section>
    </main>
  )
}

const statusCopy: Record<InvitationStatus, string> = {
  pending: 'waiting for an answer',
  accepted: 'date accepted ♡',
  needs_changes: 'another time, please',
  declined: 'not this one',
}

function InvitationRow({ invitation, sent }: { invitation: DateInvitation; sent: boolean }) {
  const activity = activities.find((item) => item.id === invitation.activity)
  const preview = getPlanTimes({
    date: invitation.date,
    time: invitation.time,
    guestTimeZone: invitation.guest_timezone,
  })

  return (
    <a className='invitation-row' href={`#/invite/${invitation.id}`}>
      <span className='invitation-icon' aria-hidden='true'>{activity?.icon ?? '♥'}</span>
      <span className='invitation-main'>
        <strong>{activity?.label ?? 'Our date'}</strong>
        <span>{sent ? 'You sent this' : 'Your person invited you'} · {preview?.guest ?? invitation.date}</span>
      </span>
      <span className={`invite-status invite-status--${invitation.status}`}>{statusCopy[invitation.status]}</span>
    </a>
  )
}

export function InboxPage() {
  const { configured, loading, user, pairing, receivedInvites, sentInvites } = useOnline()
  if (!configured) return <OnlineSetupNotice />
  if (!loading && !user) return <AccountPage />

  return (
    <main className='online-screen inbox-screen'>
      <section className='mailbox-paper inbox-paper'>
        <div className='mailbox-mark' aria-hidden='true'>✉</div>
        <h1>Our date invitations</h1>
        {!pairing.partner ? (
          <div className='empty-mailbox'>
            <p>First, connect your account with your person.</p>
            <a href='#/pair' className='pixel-button link-button'>PAIR OUR ACCOUNTS</a>
          </div>
        ) : (
          <>
            <div className='inbox-toolbar'>
              <p>{pairing.partner.display_name} is your one and only date recipient ♡</p>
              <a href='#/plan' className='pixel-button link-button'>INVITE THEM</a>
            </div>
            <section className='invite-list'>
              <h2>For you</h2>
              {receivedInvites.length
                ? receivedInvites.map((invite) => <InvitationRow key={invite.id} invitation={invite} sent={false} />)
                : <p className='empty-list'>No incoming tickets yet. The mailbox is listening.</p>}
            </section>
            <section className='invite-list'>
              <h2>From you</h2>
              {sentInvites.length
                ? sentInvites.map((invite) => <InvitationRow key={invite.id} invitation={invite} sent />)
                : <p className='empty-list'>You haven’t sent a date ticket yet.</p>}
            </section>
          </>
        )}
        <a href='#/account' className='mailbox-home-link'>← my account</a>
      </section>
    </main>
  )
}

export function InvitationPage({ invitationId }: { invitationId: string }) {
  const { loading, user, pairing, receivedInvites, sentInvites, respondToInvitation } = useOnline()
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const invitation = useMemo(
    () => [...receivedInvites, ...sentInvites].find((item) => item.id === invitationId),
    [invitationId, receivedInvites, sentInvites],
  )

  if (!loading && !user) return <AccountPage />
  if (loading) return <LoadingMailbox />
  if (!invitation) {
    return (
      <main className='online-screen'><section className='mailbox-paper missing-invite'>
        <h1>This ticket isn’t in your mailbox</h1>
        <p>It may belong to the other cutie, or it is still flying through the clouds.</p>
        <a href='#/inbox' className='pixel-button link-button'>BACK TO OUR MAILBOX</a>
      </section></main>
    )
  }

  const incoming = invitation.recipient_id === user?.id
  const activity = activities.find((item) => item.id === invitation.activity)
  const times = getPlanTimes({
    date: invitation.date,
    time: invitation.time,
    guestTimeZone: invitation.guest_timezone,
  })

  const respond = async (status: 'accepted' | 'needs_changes' | 'declined') => {
    setBusy(true)
    setMessage('')
    try {
      await respondToInvitation(invitation.id, status, note)
      setMessage(status === 'accepted' ? 'YAY! Your person knows it’s a date ♡' : 'Your gentle reply is on its way ♡')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The reply got tangled in ribbon.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className='online-screen invitation-screen'>
      <section className='invite-ticket-online'>
        <div className='online-ticket-heading'>
          <span aria-hidden='true'>{activity?.icon}</span>
          <div><h1>{activity?.label}</h1><p>{incoming ? `${pairing.partner?.display_name ?? 'Your person'} invited you` : `sent to ${pairing.partner?.display_name ?? 'your person'}`}</p></div>
        </div>
        <div className='online-ticket-times'>
          <div><span>Their chosen time</span><strong>{times?.guest}</strong></div>
          <div><span>Amman time</span><strong>{times?.host}</strong></div>
        </div>
        <p className={`big-invite-status big-invite-status--${invitation.status}`}>{statusCopy[invitation.status]}</p>
        {invitation.response_note && <blockquote>“{invitation.response_note}”</blockquote>}

        {incoming && invitation.status === 'pending' && (
          <div className='response-box'>
            <label>
              Add a tiny note (optional)
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={240} placeholder='I can’t wait ♡' />
            </label>
            <div className='response-actions'>
              <button className='pixel-button accept-invite' disabled={busy} onClick={() => void respond('accepted')}>YES, IT’S A DATE! ♥</button>
              <button className='pixel-button reschedule-invite' disabled={busy} onClick={() => void respond('needs_changes')}>SUGGEST ANOTHER TIME</button>
              <button className='text-link decline-invite' disabled={busy} onClick={() => void respond('declined')}>not this time</button>
            </div>
          </div>
        )}
        {message && <p className='mailbox-message' role='status'>{message}</p>}
        <a href='#/inbox' className='mailbox-home-link'>← all invitations</a>
      </section>
    </main>
  )
}

function LoadingMailbox() {
  return <main className='online-screen'><section className='mailbox-paper'><p className='mailbox-loading'>Checking for tiny letters…</p></section></main>
}

function OnlineSetupNotice() {
  return (
    <main className='online-screen'>
      <section className='mailbox-paper missing-invite'>
        <h1>The online mailbox is almost ready</h1>
        <p>The app still needs its Supabase project URL and publishable key.</p>
        <a href='#/' className='pixel-button link-button'>BACK TO THE PINK SKY</a>
      </section>
    </main>
  )
}
