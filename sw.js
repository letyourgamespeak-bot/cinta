// Mínimo para que Chrome deje instalarla. Siempre va a la red: así un entreno nuevo aparece sin reinstalar.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => e.respondWith(fetch(e.request)));
