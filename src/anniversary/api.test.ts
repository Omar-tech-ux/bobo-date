import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupUnusedUploads, readStatus, saveContribution, signPhotos } from './api'
import { AnniversaryConflictError, AnniversaryUncertainError, type PhotoDraft } from './types'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), eq: vi.fn(), upload: vi.fn(), remove: vi.fn(), sign: vi.fn(), prepare: vi.fn(), result: { data: [] as unknown[], error: null as unknown } }))
vi.mock('../online/supabase', () => {
  const query = { select: mocks.select, eq: mocks.eq, then: (resolve: (result: unknown) => void) => resolve(mocks.result) }
  mocks.select.mockReturnValue(query)
  mocks.eq.mockReturnValue(query)
  return { supabase: { rpc: mocks.rpc, from: () => query, storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, createSignedUrls: mocks.sign }) } } }
})
vi.mock('./images', () => ({ preparePhoto: mocks.prepare }))
const identity = { userId: 'person', coupleId: 'pair' }
const date = '2026-10-14'
const saved = { couple_id: 'pair', user_id: 'person', anniversary_date: date, revision: 1, completed_at: 'now', photos: [{ id: 'old', slot: 1, width: 200, height: 300, object_path: 'old.jpg' }] }
const existing: PhotoDraft = { id: 'old', width: 200, height: 300, preview: 'https://example.test/photo.jpg' }
const newPhoto = (): PhotoDraft => ({ id: 'draft', width: 0, height: 0, preview: 'blob:preview', file: new File(['image'], 'photo.jpg', { type: 'image/jpeg' }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.result = { data: [], error: null }
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
  mocks.prepare.mockResolvedValue({ width: 1000, height: 1500, blob: new Blob(['pixels'], { type: 'image/jpeg' }) })
  mocks.rpc.mockResolvedValue({ data: saved, error: null })
})

describe('anniversary saving', () => {
  it('uploads new immutable objects then commits the entire selection once', async () => {
    await saveContribution(identity, date, 1, [existing, newPhoto()], vi.fn(), new AbortController().signal)
    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(mocks.upload.mock.calls[0][0]).toMatch(/^pair\/2026-10-14\/person\/[0-9a-f-]+\.jpg$/)
    expect(mocks.upload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg', upsert: false })
    const args = mocks.rpc.mock.calls[0][1]
    expect(args.p_expected_revision).toBe(1)
    expect(args.p_photos).toHaveLength(2)
    expect(args.p_photos[0].id).toBe('old')
    expect(args.p_photos[1]).toMatchObject({ width: 1000, height: 1500 })
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('never commits partial uploads or deletes the previous photo on upload failure', async () => {
    mocks.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: new Error('Connection lost') })
    await expect(saveContribution(identity, date, 1, [newPhoto(), newPhoto()], vi.fn(), new AbortController().signal)).rejects.toThrow('Connection lost')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('recovers a committed save whose response was lost', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('Network lost') })
    mocks.result.data = [saved]
    await expect(saveContribution(identity, date, 0, [existing], vi.fn(), new AbortController().signal)).resolves.toMatchObject({ revision: 1 })
  })
  it('requires review instead of silently overwriting a concurrent change', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'Conflict' } })
    mocks.result.data = [{ ...saved, revision: 3 }]
    await expect(saveContribution(identity, date, 1, [], vi.fn(), new AbortController().signal)).rejects.toBeInstanceOf(AnniversaryConflictError)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
  it('blocks blind retries when save and reconciliation both lose connectivity', async () => {
    mocks.rpc.mockRejectedValue(new Error('Offline'))
    mocks.result.error = new Error('Offline')
    await expect(saveContribution(identity, date, 0, [], vi.fn(), new AbortController().signal)).rejects.toBeInstanceOf(AnniversaryUncertainError)
  })
  it('permits deleting the last photo through the same atomic save', async () => {
    await saveContribution(identity, date, 1, [], vi.fn(), new AbortController().signal)
    expect(mocks.rpc).toHaveBeenCalledWith('save_anniversary_photos', { p_anniversary_date: date, p_expected_revision: 1, p_photos: [] })
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('rejects a fourth photo and aborted work before making requests', async () => {
    await expect(saveContribution(identity, date, 0, Array(4).fill(existing), vi.fn(), new AbortController().signal)).rejects.toThrow(/three/)
    const controller = new AbortController()
    controller.abort()
    await expect(saveContribution(identity, date, 0, [newPhoto()], vi.fn(), controller.signal)).rejects.toThrow()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('anniversary reads and cleanup', () => {
  it('does not leave loading or saving stuck on an unresponsive connection', async () => {
    vi.useFakeTimers()
    try {
      mocks.rpc.mockImplementation(() => new Promise(() => {}))
      const result = expect(readStatus()).rejects.toThrow(/took too long/)
      await vi.advanceTimersByTimeAsync(30_000)
      await result
    } finally { vi.useRealTimers() }
  })
  it('does not turn a failed status check into a completed month', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('Offline') })
    await expect(readStatus()).rejects.toThrow('Offline')
  })
  it('signs images together and leaves inaccessible photos recoverable', async () => {
    mocks.sign.mockResolvedValue({ data: [{ path: 'old.jpg', signedUrl: 'signed-url' }, { path: 'missing.jpg', error: 'missing' }], error: null })
    const photos = await signPhotos([saved.photos[0], { ...saved.photos[0], id: 'missing', object_path: 'missing.jpg' }])
    expect(photos[0].url).toBe('signed-url')
    expect(photos[1].url).toBeUndefined()
    expect(mocks.sign).toHaveBeenCalledWith(['old.jpg', 'missing.jpg'], 900)
  })
  it('cleans only server-selected orphan paths in bounded batches', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ name: 'orphan.jpg' }], error: null })
    await cleanupUnusedUploads()
    expect(mocks.rpc).toHaveBeenCalledWith('list_my_unused_anniversary_uploads', { p_limit: 20 })
    expect(mocks.remove).toHaveBeenCalledWith(['orphan.jpg'])
  })
})
