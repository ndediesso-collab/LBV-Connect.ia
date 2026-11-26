/* ORIA Assistant Web Push service worker. No message or customer data is cached. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : "Une nouvelle demande vous attend." };
  }
  const title = String(payload.title || "Nouvelle demande ORIA").slice(0, 100);
  const body = String(payload.body || "Une nouvelle demande client a été reçue.").slice(0, 220);
  const rawUrl = String(payload.url || "/assistant/demandes");
  let target = "/assistant/demandes";
  try {
    const parsed = new URL(rawUrl, self.location.origin);
    if (parsed.origin === self.location.origin) target = parsed.pathname + parsed.search + parsed.hash;
  } catch (_) {}
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/oria-logo.png",
    badge: "/oria-logo.png",
    tag: String(payload.tag || "oria-assistant-request").slice(0, 110),
    renotify: true,
    data: { url: target },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = event.notification && event.notification.data && event.notification.data.url;
  let target = new URL("/assistant/demandes", self.location.origin).href;
  try {
    const parsed = new URL(String(rawUrl || "/assistant/demandes"), self.location.origin);
    if (parsed.origin === self.location.origin) target = parsed.href;
  } catch (_) {}
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
