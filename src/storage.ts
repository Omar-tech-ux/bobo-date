import type { DatePlan } from './types'

export const PLAN_STORAGE_KEY = 'bobo-date-plan-v1'
export const STORY_PROGRESS_KEY = 'bobo-story-progress-v1'

export type StoryProgress = {
  scrapbookCompleted: boolean
  viewedGalleryIds: string[]
}

const emptyStoryProgress: StoryProgress = {
  scrapbookCompleted: false,
  viewedGalleryIds: [],
}

export function loadPlan(): DatePlan | null {
  try {
    const raw = window.localStorage.getItem(PLAN_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DatePlan) : null
  } catch {
    return null
  }
}

export function savePlan(plan: DatePlan) {
  window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan))
}

export function loadStoryProgress(): StoryProgress {
  try {
    const raw = window.localStorage.getItem(STORY_PROGRESS_KEY)
    if (!raw) return { ...emptyStoryProgress }
    const value = JSON.parse(raw) as Partial<StoryProgress>
    return {
      scrapbookCompleted: value.scrapbookCompleted === true,
      viewedGalleryIds: Array.isArray(value.viewedGalleryIds)
        ? value.viewedGalleryIds.filter((id): id is string => typeof id === 'string')
        : [],
    }
  } catch {
    return { ...emptyStoryProgress }
  }
}

export function saveStoryProgress(progress: StoryProgress) {
  window.localStorage.setItem(STORY_PROGRESS_KEY, JSON.stringify(progress))
}

export function unlockStoryWorld() {
  const progress = loadStoryProgress()
  const next = { ...progress, scrapbookCompleted: true }
  saveStoryProgress(next)
  return next
}

export function markGalleryPhotoViewed(id: string) {
  const progress = loadStoryProgress()
  const viewedGalleryIds = Array.from(new Set([...progress.viewedGalleryIds, id]))
  const next = { ...progress, viewedGalleryIds }
  saveStoryProgress(next)
  return next
}
