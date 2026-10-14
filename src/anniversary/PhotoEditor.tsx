import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useAnniversary } from './AnniversaryContext'
import { AnniversaryDialog } from './AnniversaryDialog'
import { emptyContribution, errorMessage, readSignedAlbum, saveContribution, signPhotos } from './api'
import { anniversaryLabel } from './dates'
import { validatePhotoFile } from './images'
import { AnniversaryConflictError, AnniversaryUncertainError, type AnniversaryContribution, type PhotoDraft } from './types'

export function PhotoEditor({ date, onClose, prompt = false }: { date: string; onClose: () => void; prompt?: boolean }) {
  const { identity, changed } = useAnniversary()
  const [base, setBase] = useState<AnniversaryContribution | null>(null)
  const [drafts, setDrafts] = useState<PhotoDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [mustReload, setMustReload] = useState(false)
  const [reload, setReload] = useState(0)
  const previews = useRef(new Set<string>())
  const saving = useRef(false)
  const lifetime = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    return () => {
      controller.abort()
      previews.current.forEach((url) => URL.revokeObjectURL(url))
      previews.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!identity) return
    let active = true
    setLoading(true)
    void readSignedAlbum(identity, date).then((items) => {
      if (!active) return
      const own = items.find((item) => item.user_id === identity.userId) ?? emptyContribution(identity, date)
      previews.current.forEach((url) => URL.revokeObjectURL(url))
      previews.current.clear()
      setBase(own)
      setDrafts(own.photos.map((photo) => ({ id: photo.id, width: photo.width, height: photo.height, preview: photo.url ?? '' })))
      setError('')
      setMustReload(false)
    }).catch((failure) => { if (active) setError(errorMessage(failure)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [identity, date, reload])

  useEffect(() => {
    if (!base?.photos.length) return
    let active = true
    const timer = window.setInterval(() => {
      void signPhotos(base.photos).then((photos) => {
        if (!active) return
        const urls = new Map(photos.map((photo) => [photo.id, photo.url ?? '']))
        setDrafts((current) => current.map((draft) => !draft.file && urls.has(draft.id)
          ? { ...draft, preview: urls.get(draft.id)! } : draft))
      }).catch(() => { /* Keep the selection and retry on the next refresh. */ })
    }, 12 * 60 * 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [base])

  const revoke = (draft: PhotoDraft) => {
    if (previews.current.delete(draft.preview)) URL.revokeObjectURL(draft.preview)
  }
  const choose = (event: ChangeEvent<HTMLInputElement>, replaceId?: string) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (!files.length || busy) return
    try {
      if ((replaceId ? drafts.length - 1 : drafts.length) + files.length > 3) throw new Error('Choose at most three photos in total.')
      files.forEach(validatePhotoFile)
      const additions = files.map((file) => {
        const preview = URL.createObjectURL(file)
        previews.current.add(preview)
        return { id: crypto.randomUUID(), width: 0, height: 0, preview, file }
      })
      const replaced = drafts.find((draft) => draft.id === replaceId)
      if (replaced) revoke(replaced)
      setDrafts((current) => replaceId ? current.flatMap((draft) => draft.id === replaceId ? additions : [draft]) : [...current, ...additions])
      setError('')
    } catch (failure) { setError(errorMessage(failure)) }
  }
  const dirty = base && (base.photos.length !== drafts.length || drafts.some((draft, index) => draft.id !== base.photos[index]?.id))
  const save = async () => {
    if (!identity || !base || !dirty || saving.current || mustReload) return
    saving.current = true
    setBusy(true)
    setError('')
    const signal = lifetime.current!.signal
    try {
      await saveContribution(identity, date, base.revision, drafts, (message) => { if (!signal.aborted) setProgress(message) }, signal)
      if (!signal.aborted) { changed(); onClose() }
    } catch (failure) {
      if (!signal.aborted) {
        setError(errorMessage(failure))
        setMustReload(failure instanceof AnniversaryConflictError || failure instanceof AnniversaryUncertainError)
      }
    } finally {
      saving.current = false
      if (!signal.aborted) { setBusy(false); setProgress('') }
    }
  }

  return <AnniversaryDialog title={prompt ? 'Keep a little piece of our anniversary' : 'Your anniversary photos'}
    onClose={onClose} busy={busy} closeLabel={prompt ? 'Later' : 'Close'}>
    <p className='anniversary-date'>{anniversaryLabel(date)}</p>
    <p>Save 1–3 photos from our day. Your person has their own three spaces.</p>
    {loading ? <p role='status'>Opening your photos…</p> : <>
      <fieldset className='anniversary-editor' disabled={busy || mustReload || !base}>
        <legend className='anniversary-visually-hidden'>Your photos</legend>
        <div className='anniversary-photo-grid'>
          {drafts.map((draft, index) => <div className='anniversary-photo-frame' key={draft.id}>
            {draft.preview ? <img src={draft.preview} alt={`Your photo ${index + 1}`} /> : <p>Preview unavailable</p>}
            <div className='anniversary-photo-actions'>
              <label className='anniversary-file-button'>Replace
                <input type='file' accept='image/jpeg,image/png,image/webp' aria-label={`Replace photo ${index + 1}`} onChange={(event) => choose(event, draft.id)} />
              </label>
              <button type='button' className='anniversary-small-button' onClick={() => {
                revoke(draft); setDrafts((current) => current.filter((item) => item.id !== draft.id)); setError('')
              }} aria-label={`Remove photo ${index + 1}`}>Remove</button>
            </div>
          </div>)}
        </div>
        {drafts.length < 3 && <label className='anniversary-file-button anniversary-add'>Add photos
          <input type='file' accept='image/jpeg,image/png,image/webp' multiple onChange={choose} aria-label='Add photos' />
        </label>}
        <p className='anniversary-hint'>{drafts.length} of 3 spaces used · JPEG, PNG, or WebP · up to 20 MB each</p>
      </fieldset>
      {base && base.photos.length > 0 && drafts.length === 0 && <p>Saving will remove all your photos for this month. If it is the newest anniversary, we’ll remind you on your next app load.</p>}
    </>}
    {error && <p role='alert' className='anniversary-error'>{error}</p>}
    {!loading && (mustReload || !base) && <button type='button' className='anniversary-small-button' onClick={() => setReload((value) => value + 1)}>
      {mustReload ? 'Reload saved photos' : 'Try again'}
    </button>}
    {mustReload && <p className='anniversary-hint'>Reloading discards your unsaved selection and shows what is saved now.</p>}
    <div className='anniversary-editor-footer'>
      <p role='status' aria-live='polite'>{progress || (prompt ? 'Save a photo to stop this month’s reminder.' : 'Only your own photos will change.')}</p>
      <button type='button' className='pixel-button anniversary-save' disabled={loading || busy || !dirty || mustReload} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save photos ♥'}
      </button>
    </div>
  </AnniversaryDialog>
}
