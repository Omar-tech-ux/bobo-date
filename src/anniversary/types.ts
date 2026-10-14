export type AnniversaryIdentity = { userId: string; coupleId: string }

export type AnniversaryPhoto = {
  id: string
  object_path: string
  slot: number
  width: number
  height: number
  url?: string
}

export type AnniversaryContribution = {
  couple_id: string
  anniversary_date: string
  user_id: string
  revision: number
  completed_at: string | null
  photos: AnniversaryPhoto[]
}

export type AnniversaryStatus = {
  latest_date: string | null
  completed_at: string | null
  revision: number
}

export type AnniversarySummary = Pick<AnniversaryContribution,
  'anniversary_date' | 'user_id' | 'completed_at' | 'revision'>

export type PhotoDraft = {
  id: string
  width: number
  height: number
  preview: string
  file?: File
}

export class AnniversaryConflictError extends Error {
  constructor() {
    super('Your photos changed on another device. Reload the saved photos before editing again.')
    this.name = 'AnniversaryConflictError'
  }
}

export class AnniversaryUncertainError extends Error {
  constructor() {
    super('We could not confirm whether your photos were saved. Reload the saved photos before trying again.')
    this.name = 'AnniversaryUncertainError'
  }
}
