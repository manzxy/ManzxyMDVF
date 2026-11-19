/* SERVICE WORKER — panel tetap terbuka saat internet putus.
 * Strategi:
 *  - Aset ber-?v= (app.js, css/*.css, theme.js): cache-first (URL berubah tiap update → aman).
 *  - Aset tanpa versi (icon, manifest): stale-while-revalidate.
 *  - HTML panel: network-first, gagal → fallback offline.html.
 *  - /api/* dan SSE: TIDAK pernah dicache (data harus selalu segar).
 *
 * Catatan struktur: sumber klien ada di /panel/js/*.js dan /panel/css/*.css,
 * tetapi browser hanya meminta /panel/app.js (bundle) dan dua file CSS.
 * Service worker ini hanya perlu mengenali URL yang benar-benar diminta.
 */
const VERSION = 'v6';
const SHELL_CACHE = `mz-shell-${VERSION}`;
const ASSET_CACHE = `mz-asset-${VERSION}`;
const OFFLINE_URL = '/panel/offline.html';

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET') return;
    if (url.pathname.startsWith('/api/')) return;                 // API & SSE: jangan sentuh
    if (url.origin !== location.origin) return;

    // HTML: network-first, fallback offline
    if (event.request.headers.get('accept')?.includes('text/html') || url.pathname === '/panel' || url.pathname === '/panel/') {
        event.respondWith((async () => {
            try {
                const fresh = await fetch(event.request);
                if (fresh.ok) (await caches.open(SHELL_CACHE)).put(event.request, fresh.clone());
                return fresh;
            } catch {
                const cached = await caches.match(event.request);
                return cached || caches.match(OFFLINE_URL);
            }
        })());
        return;
    }

    // Aset ber-versi: cache-first (immutable)
    if (url.search.includes('v=')) {
        event.respondWith((async () => {
            const hit = await caches.match(event.request);
            if (hit) return hit;
            const res = await fetch(event.request);
            if (res.ok) (await caches.open(ASSET_CACHE)).put(event.request, res.clone());
            return res;
        })());
        return;
    }

    // Aset lain: stale-while-revalidate
    event.respondWith((async () => {
        const cached = await caches.match(event.request);
        const network = fetch(event.request).then((res) => {
            if (res.ok) caches.open(ASSET_CACHE).then((c) => c.put(event.request, res.clone()));
            return res;
        }).catch(() => cached);
        return cached || network;
    })());
});
