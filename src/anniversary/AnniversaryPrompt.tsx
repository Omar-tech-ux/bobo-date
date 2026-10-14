import { useEffect, useState } from 'react'
import { useAnniversary } from './AnniversaryContext'
import { PhotoEditor } from './PhotoEditor'

export function AnniversaryPrompt({ ready }: { ready: boolean }) {
  const { identity, status, promptHandled, handlePrompt } = useAnniversary()
  const [date, setDate] = useState<string | null>(null)
  useEffect(() => {
    if (ready && identity && status?.latest_date && !status.completed_at && !promptHandled) {
      setDate(status.latest_date)
      handlePrompt()
    }
  }, [ready, identity, status, promptHandled, handlePrompt])
  return date && identity ? <PhotoEditor date={date} prompt onClose={() => setDate(null)} /> : null
}
