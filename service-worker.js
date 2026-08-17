const CACHE_NAME = "qcu-schedule-v22";
const STATIC_ASSETS = [
  "./",
  "index.html",
  "campus-eta.html",
  "schedule.html",
  "today.html",
  "buildings.html",
  "settings.html",
  "tasks.html",
  "notes.html",
  "offline.html",
  "manifest.json",
  "assets/css/styles.css",
  "assets/css/eta.css",
  "assets/js/app.js",
  "assets/js/eta.js",
  "assets/images/QCU college of computer studies logo.jpg",
  "assets/images/Quezon_City_Government.png",
  "assets/images/QCU-BUILDING-1024x683-1.jpg",
  "assets/images/Belmonte Building 2.jpg",
  "assets/images/New Academic building(1).jpg",
  "assets/images/Techboc HB bautista.jpg",
  "data/buildings.json"
];

// Data files that should NOT be cached (always fetch fresh)
const NO_CACHE_PATHS = [
  "data/schedule.json",
  "data/flood.json"
];

function isNoCachePath(url) {
  return NO_CACHE_PATHS.some(path => url.includes(path));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;

  // For schedule data: always fetch from network, never cache
  if (isNoCachePath(url)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (!response.ok) throw new Error("Network response not ok");
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match("offline.html")))
    );
    return;
  }

  // For static assets: network first, then cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return caches.match("offline.html");
        });
      })
  );
});
