const CACHE_NAME = 'bobo-date-shell-v3'
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icons/bobo-heart.svg', './icons/bobo-heart-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return
  if (event.request.destination === 'video' || event.request.destination === 'image') return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        return response
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match('./index.html'))),
  )
})

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {}
    try {
      data = event.data?.json() ?? {}
    } catch {
      data = { body: event.data?.text() || 'Open your love mailbox.' }
    }

    await self.registration.showNotification(data.title ?? 'A tiny letter arrived ♡', {
      body: data.body ?? 'Open your love mailbox.',
      icon: data.icon ?? './icons/bobo-heart.svg',
      badge: './icons/bobo-heart.svg',
      tag: data.tag ?? 'bobo-love-mail',
      renotify: true,
      timestamp: Date.now(),
      data: { route: data.route ?? '#/inbox' },
    })

    if ('setAppBadge' in self.registration) {
      await self.registration.setAppBadge(1)
    }
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const route = event.notification.data?.route ?? '#/inbox'
  const destination = new URL(route, self.registration.scope).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      if ('clearAppBadge' in self.registration) await self.registration.clearAppBadge()
      for (const client of clients) {
        if ('focus' in client) {
          await client.navigate(destination)
          return client.focus()
        }
      }
      return self.clients.openWindow(destination)
    }),
  )
})
