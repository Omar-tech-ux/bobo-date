import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnniversarySession } from './AnniversaryContext'
import { AnniversaryPrompt } from './AnniversaryPrompt'
import { AnniversariesPage, AnniversaryDetailPage } from './AnniversaryPages'
import { AnniversaryConflictError } from './types'

const mocks = vi.hoisted(() => ({ online: {} as Record<string, unknown>, status: vi.fn(), album: vi.fn(), summaries: vi.fn(), save: vi.fn(), cleanup: vi.fn() }))
vi.mock('../online/OnlineContext', () => ({ useOnline: () => mocks.online }))
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), readStatus: mocks.status,
  readSignedAlbum: mocks.album, readSummaries: mocks.summaries, saveContribution: mocks.save, cleanupUnusedUploads: mocks.cleanup }))

const pending = { latest_date: '2026-10-14', completed_at: null, revision: 0 }
const photo = { id: 'photo-1', object_path: 'photo.jpg', url: 'https://example.test/photo.jpg', slot: 1, width: 200, height: 300 }
const contribution = { couple_id: 'pair', user_id: 'me', anniversary_date: '2026-10-14', revision: 1, completed_at: '2026-10-15', photos: [photo] }
const file = (name = 'photo.jpg') => new File(['pixels'], name, { type: 'image/jpeg' })

function Launch({ ready = true }: { ready?: boolean }) {
  return <StrictMode><AnniversarySession><AnniversaryPrompt ready={ready} /></AnniversarySession></StrictMode>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.online = { configured: true, loading: false, user: { id: 'me' }, profile: { display_name: 'Omar' }, pairing: { coupleId: 'pair', partner: { id: 'partner', display_name: 'Leen' } } }
  mocks.status.mockResolvedValue(pending)
  mocks.album.mockResolvedValue([])
  mocks.summaries.mockResolvedValue([])
  mocks.save.mockResolvedValue(contribution)
  mocks.cleanup.mockResolvedValue(undefined)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); this.querySelector('button')?.focus() } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${crypto.randomUUID()}`), revokeObjectURL: vi.fn() }))
})

describe('monthly launch prompt', () => {
  it('waits for the intro, opens only one dialog in StrictMode, and keeps Later dismissed on foreground return', async () => {
    const user = userEvent.setup()
    const view = render(<Launch ready={false} />)
    await waitFor(() => expect(mocks.status).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<Launch />)
    await screen.findByRole('dialog')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Later' }))
    fireEvent(document, new Event('visibilitychange'))
    fireEvent(window, new Event('online'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    view.unmount()
    render(<Launch />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
  it.each([
    { configured: false }, { loading: true }, { user: null }, { pairing: { coupleId: 'pair', partner: null } },
  ])('does not prompt before a signed-in pair is ready: %j', async (state) => {
    mocks.online = { ...mocks.online, ...state }
    render(<Launch />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.status).not.toHaveBeenCalled()
  })
  it('does not prompt when complete and does not introduce a new popup on a later month’s foreground return', async () => {
    mocks.status.mockResolvedValue({ ...pending, completed_at: 'saved' })
    render(<Launch />)
    await waitFor(() => expect(mocks.status).toHaveBeenCalled())
    await act(async () => {})
    mocks.status.mockResolvedValue({ ...pending, latest_date: '2026-11-14' })
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('never treats a failed status request as completion; retries on reconnect', async () => {
    mocks.status.mockRejectedValue(new Error('Offline'))
    render(<Launch />)
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    mocks.status.mockResolvedValue(pending)
    fireEvent(window, new Event('online'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
  it('ignores a previous account’s delayed response after sign-out', async () => {
    let finish!: (value: typeof pending) => void
    mocks.status.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const view = render(<Launch />)
    mocks.online = { ...mocks.online, user: null }
    view.rerender(<Launch />)
    await act(async () => finish(pending))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('saves one photo, releases its preview, and does not prompt on a fresh load when saved', async () => {
    const user = userEvent.setup()
    const view = render(<Launch />)
    await user.upload(await screen.findByLabelText('Add photos'), file())
    mocks.status.mockResolvedValue({ ...pending, completed_at: 'saved', revision: 1 })
    await user.click(screen.getByRole('button', { name: 'Save photos ♥' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.save.mock.calls[0][3]).toHaveLength(1)
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    view.unmount()
    render(<Launch />)
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('keeps partner completion independent and allows three of your own photos', async () => {
    mocks.album.mockResolvedValue([{ ...contribution, user_id: 'partner' }])
    const user = userEvent.setup()
    render(<Launch />)
    await user.upload(await screen.findByLabelText('Add photos'), [file('one.jpg'), file('two.jpg'), file('three.jpg')])
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.queryByLabelText('Add photos')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save photos ♥' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    expect(mocks.save.mock.calls[0][3]).toHaveLength(3)
    expect(mocks.save.mock.calls[0][2]).toBe(0)
  })
  it('rejects a fourth selected photo before creating previews', async () => {
    const user = userEvent.setup()
    render(<Launch />)
    await user.upload(await screen.findByLabelText('Add photos'), [file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg')])
    expect(screen.getByRole('alert')).toHaveTextContent(/three/)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save photos ♥' })).toBeDisabled()
  })
  it('keeps failed saves open and requires reload after conflicts', async () => {
    const user = userEvent.setup()
    mocks.save.mockRejectedValue(new AnniversaryConflictError())
    render(<Launch />)
    await user.upload(await screen.findByLabelText('Add photos'), file())
    await user.click(screen.getByRole('button', { name: 'Save photos ♥' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/another device/)
    expect(screen.getByRole('button', { name: 'Save photos ♥' })).toBeDisabled()
    mocks.album.mockResolvedValue([contribution])
    await user.click(screen.getByRole('button', { name: 'Reload saved photos' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('img')).toHaveAttribute('src', photo.url)
  })
  it('stops background keyboard handlers and restores focus when dismissed', async () => {
    const handler = vi.fn()
    window.addEventListener('keydown', handler)
    render(<Launch />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(handler).not.toHaveBeenCalled()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    window.removeEventListener('keydown', handler)
  })
})

describe('anniversary history and photo management', () => {
  it('lists missing months newest first with separate partner status', async () => {
    mocks.status.mockResolvedValue({ ...pending, latest_date: '2026-12-14' })
    mocks.summaries.mockResolvedValue([{ ...contribution, user_id: 'partner' }])
    render(<AnniversarySession><AnniversariesPage /></AnniversarySession>)
    const list = await screen.findByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual(['December 14, 2026', 'November 14, 2026', 'October 14, 2026'])
    expect(items[2]).toHaveTextContent('You · No photos yet')
    expect(items[2]).toHaveTextContent('Leen · Photos saved')
  })
  it('shows a clear empty state before the first eligible month', async () => {
    mocks.status.mockResolvedValue({ ...pending, latest_date: null })
    render(<AnniversarySession><AnniversariesPage /></AnniversarySession>)
    expect(await screen.findByText(/first album opens/)).toHaveTextContent('October 15, 2026')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
  it('shows both contributions, edits only your photos, and clears completion when the last photo is removed', async () => {
    const user = userEvent.setup()
    mocks.album.mockResolvedValue([contribution, { ...contribution, user_id: 'partner', photos: [{ ...photo, id: 'partner-photo' }] }])
    render(<AnniversarySession><AnniversaryDetailPage month='2026-10' /></AnniversarySession>)
    await screen.findByRole('button', { name: 'Edit your photos' })
    expect(screen.getAllByRole('img')).toHaveLength(2)
    expect(within(screen.getByRole('region', { name: 'Leen’s photos' })).queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit your photos' }))
    await user.click(await screen.findByRole('button', { name: 'Remove photo 1' }))
    expect(screen.getByText(/Saving will remove all/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save photos ♥' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce())
    expect(mocks.save.mock.calls[0][3]).toEqual([])
  })
  it('does not fetch photos for future or invalid month links', async () => {
    render(<AnniversarySession><AnniversaryDetailPage month='2026-11' /></AnniversarySession>)
    expect(await screen.findByText(/This album opens/)).toBeInTheDocument()
    expect(mocks.album).not.toHaveBeenCalled()
  })
  it('renders invalid links without leaving signed-out visitors in a loading state', () => {
    mocks.online = { ...mocks.online, user: null }
    render(<AnniversarySession><AnniversaryDetailPage month='2026-13' /></AnniversarySession>)
    expect(screen.getByRole('heading', { name: 'Anniversary not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to our anniversaries →' })).toHaveAttribute('href', '#/anniversaries')
    expect(mocks.album).not.toHaveBeenCalled()
  })
})
