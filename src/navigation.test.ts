import { describe, expect, it } from 'vitest'
import { accountRoute, getSafeReturnRoute, readHashLocation } from './navigation'

describe('hash navigation helpers', () => {
  it('parses route queries without folding them into the route path', () => {
    const location = readHashLocation('#/account?next=%2Fmemories')
    expect(location.path).toBe('/account')
    expect(location.search.get('next')).toBe('/memories')
  })

  it('preserves only known internal story destinations', () => {
    expect(accountRoute('/memories')).toBe('/account?next=%2Fmemories')
    expect(accountRoute('https://example.com')).toBe('/account')

    window.location.hash = '#/account?next=https%3A%2F%2Fexample.com'
    expect(getSafeReturnRoute()).toBe('/inbox')
  })
})
