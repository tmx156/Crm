// Calendar Performance Service Worker
const CACHE_NAME = 'crm-calendar-v1';
const CALENDAR_CACHE = 'calendar-events-v1';

// Cache critical calendar assets
const STATIC_ASSETS = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/static/media/calendar-icons.woff2'
];

// Install service worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// Intercept calendar API requests
self.addEventListener('fetch', event => {
  try {
    // Skip iframe requests that cause frame removal errors
    if (event.request.mode === 'navigate' && event.request.destination === 'iframe') {
      return; // Let browser handle iframe requests
    }

    const url = new URL(event.request.url);

    // Calendar API caching strategy
    if (url.pathname === '/api/leads/calendar') {
      event.respondWith(handleCalendarRequest(event.request));
      return;
    }

    // Static assets - cache first
    if (event.request.destination === 'script' ||
        event.request.destination === 'style') {
      event.respondWith(cacheFirst(event.request));
      return;
    }

    // Default to network first
    event.respondWith(networkFirst(event.request));
  } catch (error) {
    // Handle frame removal or other lifecycle errors silently
    if (error.message && error.message.includes('Frame')) {
      // Silently ignore frame-related errors
      return;
    }
    console.warn('SW: Fetch event handler error:', error.message);
    // Let the request proceed normally
  }
});

// Calendar-specific caching with smart invalidation
async function handleCalendarRequest(request) {
  const url = new URL(request.url);
  const cacheKey = `calendar-${url.searchParams.toString()}`;

  try {
    // Check cache first for quick loading
    const cachedResponse = await caches.match(cacheKey);

    // If cached and less than 2 minutes old, use it
    if (cachedResponse) {
      const cacheTime = cachedResponse.headers.get('sw-cache-time');
      const isRecent = cacheTime && (Date.now() - parseInt(cacheTime)) < 120000; // 2 minutes

      if (isRecent) {
        console.log('🚀 SW: Serving cached calendar data');
        return cachedResponse;
      }
    }

    // Fetch fresh data
    console.log('🌐 SW: Fetching fresh calendar data');
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      try {
        // Clone and add cache timestamp
        const responseClone = networkResponse.clone();
        const headers = new Headers(responseClone.headers);
        headers.set('sw-cache-time', Date.now().toString());

        const cachedResponse = new Response(responseClone.body, {
          status: responseClone.status,
          statusText: responseClone.statusText,
          headers: headers
        });

        // Cache the response
        const cache = await caches.open(CALENDAR_CACHE);
        await cache.put(cacheKey, cachedResponse);
      } catch (cacheError) {
        console.warn('SW: Failed to cache response:', cacheError.message);
      }

      return networkResponse;
    }

    // Network failed, return stale cache if available
    return cachedResponse || new Response('{"leads": [], "error": "offline"}', {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.warn('SW: Calendar request failed:', error.message);

    try {
      // Return cached data as fallback
      const cachedResponse = await caches.match(cacheKey);
      return cachedResponse || new Response('{"leads": [], "error": "offline"}', {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (cacheError) {
      console.warn('SW: Cache access failed:', cacheError.message);
      return new Response('{"leads": [], "error": "cache_unavailable"}', {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}

// Cache-first strategy for static assets
async function cacheFirst(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, networkResponse.clone());
      } catch (cacheError) {
        console.warn('SW: Failed to cache static asset:', cacheError.message);
      }
    }
    return networkResponse;
  } catch (error) {
    console.warn('SW: Cache-first strategy failed:', error.message);
    throw error; // Re-throw to let fetch handler deal with it
  }
}

// Network-first with cache fallback
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && request.method === 'GET') {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, networkResponse.clone());
      } catch (cacheError) {
        console.warn('SW: Failed to cache network response:', cacheError.message);
      }
    }
    return networkResponse;
  } catch (error) {
    console.warn('SW: Network request failed:', error.message);
    try {
      const cachedResponse = await caches.match(request);
      return cachedResponse || new Response('Offline', { status: 503 });
    } catch (cacheError) {
      console.warn('SW: Cache fallback failed:', cacheError.message);
      return new Response('Service Unavailable', { status: 503 });
    }
  }
}

// Clear old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(async cacheName => {
            if (cacheName.startsWith('crm-calendar-') && cacheName !== CACHE_NAME) {
              try {
                await caches.delete(cacheName);
                console.log(`SW: Deleted old cache: ${cacheName}`);
              } catch (deleteError) {
                console.warn(`SW: Failed to delete cache ${cacheName}:`, deleteError.message);
              }
            }
          })
        );
      } catch (error) {
        console.warn('SW: Activate event failed:', error.message);
      }
    })()
  );
});