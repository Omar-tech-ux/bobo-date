import { useEffect, useId, useRef, type ReactNode } from 'react'

export function AnniversaryDialog({ title, children, onClose, busy = false, closeLabel = 'Close' }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; closeLabel?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    // Removing a focused photo button can temporarily leave focus on <body>.
    // Keep global scrapbook/game shortcuts inert even during that transition.
    const blockOutsideKeys = (event: KeyboardEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', blockOutsideKeys, true)
    return () => {
      window.removeEventListener('keydown', blockOutsideKeys, true)
      dialog.close()
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return <dialog ref={ref} className='anniversary-dialog' aria-labelledby={titleId}
    onKeyDown={(event) => event.stopPropagation()}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <header className='anniversary-dialog-heading'>
      <h2 id={titleId}>{title}</h2>
      <button type='button' className='anniversary-small-button' onClick={onClose} disabled={busy}>{closeLabel}</button>
    </header>
    {children}
  </dialog>
}
