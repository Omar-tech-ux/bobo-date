import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isOnlineConfigured =
  import.meta.env.MODE !== 'test' &&
  Boolean(url?.startsWith('https://') && publishableKey?.startsWith('sb_publishable_'))

export const supabase = isOnlineConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export function getAppUrl(route = '/account') {
  return `${window.location.origin}${window.location.pathname}#${route}`
}
