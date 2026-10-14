import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useOnline } from '../online/OnlineContext'
import { useAnniversary } from './AnniversaryContext'
import { AnniversaryDialog } from './AnniversaryDialog'
import { PhotoEditor } from './PhotoEditor'
import { errorMessage, readSignedAlbum, readSummaries } from './api'
import { anniversaryDateForMonth, anniversaryLabel, anniversaryMonths } from './dates'
import type { AnniversaryContribution, AnniversaryPhoto, AnniversarySummary } from './types'

function AlbumShell({ children, detail = false }: { children: ReactNode; detail?: boolean }) {
  return <main className='story-screen anniversary-screen'>
    <nav className='story-travel-nav' aria-label='Anniversary navigation'>
      <a href={detail ? '#/anniversaries' : '#/memories'}>{detail ? '← ANNIVERSARIES' : '← OUR PLACES'}</a>
      <a href='#/inbox'>♡ MAILBOX</a>
    </nav>
    <div className='anniversary-paper'>{children}</div>
  </main>
}

function AnniversaryAccess({ children }: { children: ReactNode }) {
  const { configured, loading, user, pairing } = useOnline()
  const { status, error, refresh } = useAnniversary()
  if (!configured) return <AlbumShell><h1>Our anniversaries</h1><p>Connect the online mailbox to keep your anniversary photos together.</p></AlbumShell>
  if (loading || !user) return <AlbumShell><p role='status'>Opening our anniversary album…</p></AlbumShell>
  if (!pairing.partner) return <AlbumShell><h1>Our anniversaries</h1><p>Connect your two accounts to share anniversary photos.</p><a href='#/pair'>Pair our accounts →</a></AlbumShell>
  if (!status) return <AlbumShell>{error ? <><p role='alert'>{error}</p><button className='anniversary-small-button' onClick={() => void refresh()}>Try again</button></> : <p role='status'>Opening our anniversary album…</p>}</AlbumShell>
  return children
}

export function AnniversariesPage() {
  return <AnniversaryAccess><AnniversaryList /></AnniversaryAccess>
}

function savedLabel(summary?: AnniversarySummary) {
  return summary?.completed_at ? 'Photos saved' : 'No photos yet'
}

function AnniversaryList() {
  const { pairing } = useOnline()
  const { identity, status, version } = useAnniversary()
  const [summaries, setSummaries] = useState<AnniversarySummary[] | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!identity) return
    let active = true
    void readSummaries(identity).then((items) => { if (active) { setSummaries(items); setError('') } })
      .catch((failure) => { if (active) setError(errorMessage(failure)) })
    return () => { active = false }
  }, [identity, version, retry])
  const byOwner = useMemo(() => new Map((summaries ?? []).map((item) => [`${item.anniversary_date}:${item.user_id}`, item])), [summaries])
  const months = anniversaryMonths(status?.latest_date ?? null)
  return <AlbumShell>
    <header className='anniversary-heading'><span aria-hidden='true'>♡</span><h1>Our anniversaries</h1><p>A place for every month of us.</p></header>
    {error && <div className='anniversary-error'><p role='alert'>{error}</p><button className='anniversary-small-button' onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
    {!months.length ? <p className='anniversary-empty'>Our first album opens on October 15, 2026, in Amman time.</p>
      : !summaries ? !error && <p role='status'>Finding our months…</p>
      : <ol className='anniversary-months'>{months.map((date) => <li key={date}>
        <a className='anniversary-month' href={`#/anniversaries/${date.slice(0, 7)}`}>
          <span className='anniversary-month-icon' aria-hidden='true'>▧</span>
          <div><h2>{anniversaryLabel(date)}</h2><p>You · {savedLabel(byOwner.get(`${date}:${identity!.userId}`))}</p>
            <p>{pairing.partner?.display_name} · {savedLabel(byOwner.get(`${date}:${pairing.partner?.id}`))}</p></div>
          <span className='anniversary-open' aria-hidden='true'>Open →</span>
        </a>
      </li>)}</ol>}
    <p className='anniversary-hint'>Each month opens on the 15th, after our anniversary. Three photos each, kept here together.</p>
  </AlbumShell>
}

export function AnniversaryDetailPage({ month }: { month: string }) {
  if (!anniversaryDateForMonth(month)) return <AlbumShell detail><h1>Anniversary not found</h1><p>Choose a month from our anniversary list.</p><a href='#/anniversaries'>Back to our anniversaries →</a></AlbumShell>
  return <AnniversaryAccess><AnniversaryDetail key={month} month={month} /></AnniversaryAccess>
}

function AlbumImage({ photo, alt, onRetry }: { photo: AnniversaryPhoto; alt: string; onRetry: () => void }) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>()
  return photo.url && failedUrl !== photo.url
    ? <img src={photo.url} alt={alt} width={photo.width} height={photo.height} loading='lazy' decoding='async' onError={() => setFailedUrl(photo.url)} />
    : <span className='anniversary-image-fallback' role='img' aria-label={alt}>Photo unavailable.
      <button type='button' className='anniversary-small-button' onClick={() => { setFailedUrl(undefined); onRetry() }}>Reload photo</button>
    </span>
}

function AnniversaryDetail({ month }: { month: string }) {
  const { profile, pairing } = useOnline()
  const { identity, status, version } = useAnniversary()
  const date = anniversaryDateForMonth(month)
  const eligible = Boolean(date && status?.latest_date && date <= status.latest_date)
  const [album, setAlbum] = useState<AnniversaryContribution[] | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [editing, setEditing] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const reload = () => setRefresh((value) => value + 1)
  useEffect(() => {
    if (!identity || !date || !eligible) return
    let active = true
    void readSignedAlbum(identity, date).then((items) => { if (active) { setAlbum(items); setError('') } })
      .catch((failure) => { if (active) setError(errorMessage(failure)) })
    // Renew signed URLs before their 15-minute expiry while this album is open.
    const timer = window.setTimeout(() => setRefresh((value) => value + 1), 12 * 60 * 1000)
    return () => { active = false; window.clearTimeout(timer) }
  }, [identity, date, eligible, version, refresh])
  const selected = album?.flatMap((item) => item.photos).find((photo) => photo.id === viewing)
  return <AlbumShell detail>
    <header className='anniversary-heading'><span aria-hidden='true'>♡</span><h1>{date ? anniversaryLabel(date) : 'Anniversary not found'}</h1><p>Our day, through both our eyes.</p></header>
    {!eligible ? <p className='anniversary-empty'>{date ? 'This album opens on the 15th of its month, in Amman time.' : 'Choose an anniversary from our album list.'}</p> : <>
      {error && <div className='anniversary-error'><p role='alert'>{error}</p><button className='anniversary-small-button' onClick={reload}>Try again</button></div>}
      {!album ? !error && <p role='status'>Opening our photos…</p> : [
        { id: identity!.userId, name: profile?.display_name || 'You', own: true },
        { id: pairing.partner!.id, name: pairing.partner!.display_name, own: false },
      ].map((person) => {
        const contribution = album.find((item) => item.user_id === person.id)
        const photos = contribution?.photos ?? []
        return <section className='anniversary-contribution' key={person.id} aria-label={`${person.name}’s photos`}>
          <div className='anniversary-contribution-heading'><div><h2>{person.name}’s photos</h2><p>{photos.length ? `${photos.length} of 3 photos · Saved` : 'No photos yet'}</p></div>
            {person.own && <button className='anniversary-small-button' onClick={() => setEditing(true)}>{photos.length ? 'Edit your photos' : 'Add your photos'}</button>}
          </div>
          {photos.length ? <div className='anniversary-photo-grid'>{photos.map((photo, index) => <figure className='anniversary-photo-frame' key={photo.id}>
            <AlbumImage photo={photo} alt={`${person.name}’s anniversary photo ${index + 1}`} onRetry={reload} />
            <button className='anniversary-view-button' aria-label={`Enlarge ${person.name}’s photo ${index + 1}`} onClick={() => setViewing(photo.id)}>View photo ↗</button>
          </figure>)}</div> : <p className='anniversary-empty'>{person.own ? 'Your memories of this day belong here.' : `A little space waiting for ${person.name}.`}</p>}
        </section>
      })}
    </>}
    {editing && date && <PhotoEditor date={date} onClose={() => setEditing(false)} />}
    {selected && <AnniversaryDialog title='A little piece of us' onClose={() => setViewing(null)}><div className='anniversary-large-photo'><AlbumImage photo={selected} alt={`Anniversary memory from ${anniversaryLabel(date!)}`} onRetry={reload} /></div></AnniversaryDialog>}
  </AlbumShell>
}
