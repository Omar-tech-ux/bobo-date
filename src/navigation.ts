const SAFE_RETURN_ROUTES = new Set([
  '/memories',
  '/scrapbook',
  '/world',
  '/cinema',
  '/gallery-room',
])

export type HashLocation = {
  path: string
  search: URLSearchParams
}

export function readHashLocation(hash = window.location.hash): HashLocation {
  const raw = hash.slice(1) || '/'
  const questionMark = raw.indexOf('?')
  const path = questionMark === -1 ? raw : raw.slice(0, questionMark)
  const query = questionMark === -1 ? '' : raw.slice(questionMark + 1)
  return { path: path || '/', search: new URLSearchParams(query) }
}

export function navigate(route: string) {
  window.location.hash = route
}

export function accountRoute(next?: string) {
  return next && SAFE_RETURN_ROUTES.has(next)
    ? `/account?next=${encodeURIComponent(next)}`
    : '/account'
}

export function getSafeReturnRoute(fallback = '/inbox') {
  const next = readHashLocation().search.get('next')
  return next && SAFE_RETURN_ROUTES.has(next) ? next : fallback
}

export function isStoryRoute(path: string) {
  return SAFE_RETURN_ROUTES.has(path)
}
