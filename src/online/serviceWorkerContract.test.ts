import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const serviceWorkerPath = resolve(process.cwd(), 'public/service-worker.js')
const serviceWorker = readFileSync(serviceWorkerPath, 'utf8')

describe('service worker push fallback', () => {
  it('handles declarative payloads while retaining imperative notification display', () => {
    expect(serviceWorker).toContain('data.web_push === 8030')
    expect(serviceWorker).toContain('data.notification')
    expect(serviceWorker).toContain('self.registration.showNotification')
    expect(serviceWorker).toContain('proposed.navigate')
  })

  it('uses the PNG app icon and preserves notification routes', () => {
    expect(serviceWorker).toContain('./icons/bobo-heart-512.png')
    expect(serviceWorker).toContain("data: { route, navigate }")
  })
})
