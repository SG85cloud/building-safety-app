/* ==========================================================================
   ???????????????? ?????Service Worker (PWA Offline Engine v61.0)
   ========================================================================== */

const CACHE_NAME = 'building-safety-v64.6';
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './js/core/state.js',
    './js/tabs/registry.js',
    './js/tabs/home.js',
    './js/tabs/map.js',
    './js/tabs/survey.js',
    './js/tabs/ndt.js',
    './js/shared/report.js',
    './js/shared/auth.js',
    './app.js',
    './manifest.json',
    './templates/hwpx_survey_template.hwpx',
    './templates/hwpx_survey_template_regular.hwpx',
    './templates/hwpx_survey_template_grade3.hwpx',
    './templates/hwpx_survey_template_grade3_regular.hwpx',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/dist/dxf-parser.js'
];

// Install Event: Cache Core Assets
self.addEventListener('install', (event) => {
    console.log('[ServiceWorker] Installing & Caching Static Assets...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[ServiceWorker] Some assets failed to cache during install:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

// Activate Event: Cleanup Old Caches
self.addEventListener('activate', (event) => {
    console.log('[ServiceWorker] Activating & Cleaning Old Caches...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[ServiceWorker] Removing old cache:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch Event: Network-First with Cache Fallback for offline usability
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    // Skip Firebase Firestore real-time WS or POST connections
    const url = event.request.url;
    if (url.includes('firestore.googleapis.com') || url.includes('google.com/recaptcha')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                console.log('[ServiceWorker] Network request failed. Serving from Cache:', url);
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;
                    const accept = event.request.headers.get('accept') || '';
                    if (accept.includes('text/html')) {
                        return caches.match('./index.html');
                    }
                    return new Response('?????? ?????? ??????? ??????????.', {
                        status: 503,
                        statusText: 'Offline',
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                });
            })
    );
});
