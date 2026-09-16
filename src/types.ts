export const activities = [
  { id: 'video-dinner', label: 'Video dinner', icon: '🍜' },
  { id: 'movie-night', label: 'Movie watch party', icon: '🎬' },
  { id: 'online-game', label: 'Online game', icon: '🎮' },
  { id: 'coffee-call', label: 'Coffee & call', icon: '☕' },
  { id: 'surprise', label: 'Surprise me', icon: '🎁' },
] as const

export type ActivityId = (typeof activities)[number]['id']

export type DatePlan = {
  date: string
  time: string
  activities: ActivityId[]
  guestTimeZone: string
  hostTimeZone: 'Asia/Amman'
  createdAt: string
}

// Accept legacy tickets at the boundary; always render in menu order.
export function selectedActivities(value: { activities?: unknown; activity?: unknown }) {
  const ids = Array.isArray(value.activities) ? value.activities : [value.activity]
  return activities.filter((item) => ids.includes(item.id))
}
