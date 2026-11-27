const cacheName = 'inchill-shell-__VERSION__';
const assets = /* assets */ [];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => cache.addAll(assets))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('inchill-shell-') && name !== cacheName) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== location.origin ||
    event.request.method !== 'GET' ||
    !assets.includes(url.pathname) ||
    url.search
  )
    return;
  event.respondWith(
    caches
      .open(cacheName)
      .then(async (cache) => (await cache.match(event.request)) || fetch(event.request)),
  );
});
self.addEventListener('push', (event) =>
  event.waitUntil(
    (async () => {
      const data = event.data?.json() || {};
      await self.registration.showNotification('Inbox & Chill', {
        body: data.test
          ? 'Your test notification arrived.'
          : 'Your private inbox has new activity.',
        icon: '/icon-192.png',
        tag: data.test ? 'inchill-test' : 'inchill-inbox',
      });
      if (Number.isSafeInteger(data.count) && data.count >= 0 && navigator.setAppBadge) {
        await navigator.setAppBadge(data.count);
      }
    })(),
  ),
);
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const inbox = windows.find((client) => new URL(client.url).origin === location.origin);
      if (inbox) return inbox.focus();
      return self.clients.openWindow('/');
    })(),
  );
});
