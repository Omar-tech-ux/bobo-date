import { supabase } from '../online/supabase'
import { preparePhoto } from './images'
import { AnniversaryConflictError, AnniversaryUncertainError } from './types'
import type { AnniversaryContribution, AnniversaryIdentity, AnniversaryPhoto, AnniversaryStatus, AnniversarySummary, PhotoDraft } from './types'

export const ANNIVERSARY_BUCKET = 'anniversary-photos'
const CONTRIBUTION_SELECT = 'couple_id,anniversary_date,user_id,revision,completed_at,photos:anniversary_photos(id,object_path,slot,width,height)'

function client() {
  if (!supabase) throw new Error('The online album is not connected yet.')
  return supabase
}

async function withTimeout<T>(request: PromiseLike<T>, milliseconds = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The connection took too long. Check your internet and try again.')), milliseconds)
    })])
  } finally {
    clearTimeout(timer)
  }
}

export function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return 'Could not reach your album. Check your connection and try again.'
}

export function emptyContribution(identity: AnniversaryIdentity, date: string): AnniversaryContribution {
  return { couple_id: identity.coupleId, user_id: identity.userId, anniversary_date: date, revision: 0, completed_at: null, photos: [] }
}

export async function readStatus(): Promise<AnniversaryStatus> {
  const { data, error } = await withTimeout(client().rpc('get_anniversary_status'))
  if (error) throw error
  return data as AnniversaryStatus
}

export async function readSummaries(identity: AnniversaryIdentity): Promise<AnniversarySummary[]> {
  const { data, error } = await withTimeout(client().from('anniversary_contributions')
    .select('anniversary_date,user_id,completed_at,revision').eq('couple_id', identity.coupleId)
    .order('anniversary_date', { ascending: false }))
  if (error) throw error
  return data ?? []
}

export async function readAlbum(identity: AnniversaryIdentity, date: string): Promise<AnniversaryContribution[]> {
  const { data, error } = await withTimeout(client().from('anniversary_contributions').select(CONTRIBUTION_SELECT)
    .eq('couple_id', identity.coupleId).eq('anniversary_date', date))
  if (error) throw error
  return ((data ?? []) as AnniversaryContribution[]).map((item) => ({ ...item, photos: [...item.photos].sort((a, b) => a.slot - b.slot) }))
}

export async function signPhotos(photos: AnniversaryPhoto[]): Promise<AnniversaryPhoto[]> {
  if (!photos.length) return []
  const { data, error } = await withTimeout(client().storage.from(ANNIVERSARY_BUCKET)
    .createSignedUrls(photos.map((photo) => photo.object_path), 15 * 60))
  if (error) throw error
  const urls = new Map((data ?? []).map((item) => [item.path, item.signedUrl]))
  return photos.map((photo) => ({ ...photo, url: urls.get(photo.object_path) || undefined }))
}

export async function readSignedAlbum(identity: AnniversaryIdentity, date: string) {
  const album = await readAlbum(identity, date)
  const signed = await signPhotos(album.flatMap((item) => item.photos))
  const byId = new Map(signed.map((photo) => [photo.id, photo]))
  return album.map((item) => ({ ...item, photos: item.photos.map((photo) => byId.get(photo.id)!) }))
}

export async function cleanupUnusedUploads() {
  const { data, error } = await withTimeout(client().rpc('list_my_unused_anniversary_uploads', { p_limit: 20 }))
  if (error) throw error
  const names = ((data ?? []) as { name: string }[]).map((item) => item.name)
  if (names.length) {
    const result = await withTimeout(client().storage.from(ANNIVERSARY_BUCKET).remove(names))
    if (result.error) throw result.error
  }
}

export async function saveContribution(
  identity: AnniversaryIdentity,
  date: string,
  revision: number,
  drafts: PhotoDraft[],
  progress: (message: string) => void,
  signal: AbortSignal,
): Promise<AnniversaryContribution> {
  if (drafts.length > 3) throw new Error('You can save up to three photos for each anniversary.')
  const photos: { id: string; width: number; height: number }[] = []
  // Process only one full-resolution image at a time, bounding mobile memory use.
  for (const [index, draft] of drafts.entries()) {
    signal.throwIfAborted()
    if (draft.file) {
      progress(`Preparing photo ${index + 1} of ${drafts.length}…`)
      const prepared = await preparePhoto(draft.file, signal)
      signal.throwIfAborted()
      // A fresh immutable ID on every attempt avoids overwrite/CDN and stale-upload problems.
      const id = crypto.randomUUID()
      const path = `${identity.coupleId}/${date}/${identity.userId}/${id}.jpg`
      progress(`Uploading photo ${index + 1} of ${drafts.length}…`)
      const { error } = await withTimeout(client().storage.from(ANNIVERSARY_BUCKET)
        .upload(path, prepared.blob, { contentType: 'image/jpeg', upsert: false }), 60_000)
      if (error) throw error
      photos.push({ id, width: prepared.width, height: prepared.height })
    } else {
      photos.push({ id: draft.id, width: draft.width, height: draft.height })
    }
  }
  signal.throwIfAborted()
  progress('Saving your anniversary…')
  let failure: unknown
  try {
    const { data, error } = await withTimeout(client().rpc('save_anniversary_photos', {
      p_anniversary_date: date, p_expected_revision: revision, p_photos: photos,
    }))
    if (!error) return data as AnniversaryContribution
    failure = error
  } catch (error) {
    failure = error
  }
  // A lost HTTP response does not mean that the transaction rolled back.
  let current: AnniversaryContribution
  try {
    current = (await readAlbum(identity, date)).find((item) => item.user_id === identity.userId)
      ?? emptyContribution(identity, date)
  } catch {
    throw new AnniversaryUncertainError()
  }
  if (current.revision === revision + 1 && current.photos.length === photos.length
    && current.photos.every((photo, index) => photo.id === photos[index].id)) return current
  if (current.revision !== revision) throw new AnniversaryConflictError()
  throw new Error(errorMessage(failure))
}
