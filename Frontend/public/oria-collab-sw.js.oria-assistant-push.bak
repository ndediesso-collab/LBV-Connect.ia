/* ORIA Collaboratif P16. Service Worker Web Push sans interception des requêtes. */
/* Aucune clé API, aucun jeton d'authentification. */
self.addEventListener('install', function (event) { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 100) : 'ORIA Collaboratif';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 220) : 'Nouveau message.';
  const candidate = typeof payload.url === 'string' ? payload.url : '/collaboratif/espaces';
  let path = '/collaboratif/espaces';
  try {
    const url = new URL(candidate, self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith('/collaboratif/espaces/'))
      path = url.pathname + url.search;
  } catch (_) {}
  const tag = typeof payload.tag === 'string' ? payload.tag.slice(0, 110) : 'oria-collab';
  event.waitUntil(self.registration.showNotification(title, {
    body: body, icon: '/oria-logo.png', badge: '/oria-logo.png',
    tag: tag, renotify: false, data: { url: path },
    // N'inclure ni message complet ni identifiant secret.
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const path = event.notification.data && event.notification.data.url || '/collaboratif/espaces';
  event.waitUntil((async function () {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        try { await client.navigate(path); } catch (_) {}
        return client.focus();
      }
    }
    return self.clients.openWindow(path);
  })());
});
