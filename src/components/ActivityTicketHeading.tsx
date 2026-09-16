import { selectedActivities } from '../types'

type ActivityValue = { activities?: unknown; activity?: unknown }

export function ActivityList({ value, compact = false }: { value: ActivityValue; compact?: boolean }) {
  return (
    <ul className={`ticket-activities${compact ? ' ticket-activities--compact' : ''}`} aria-label="Date activities">
      {selectedActivities(value).map((item) => (
        <li key={item.id}><span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong></li>
      ))}
    </ul>
  )
}

export function ActivityTicketHeading({ value, subtitle, className }: {
  value: ActivityValue; subtitle: string; className: string
}) {
  const chosen = selectedActivities(value)
  const multiple = chosen.length > 1
  return (
    <>
      <div className={className}>
        <span aria-hidden="true">{multiple ? '♥' : chosen[0]?.icon ?? '♥'}</span>
        <div><h1>{multiple ? 'Our little date' : chosen[0]?.label ?? 'Our date'}</h1><p>{subtitle}</p></div>
      </div>
      {multiple && <ActivityList value={value} />}
    </>
  )
}
