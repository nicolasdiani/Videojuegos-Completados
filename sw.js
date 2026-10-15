// Service worker mínimo: Chrome en Android lo pide para ofrecer "Instalar".
// No guarda nada en caché: las páginas se piden siempre a la red (los datos van directo a Supabase).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request));
});
