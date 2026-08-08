const CACHE_NAME = "qcu-schedule-v12";
const ASSETS = [
  "./",
  "index.html",
  "schedule.html",
  "today.html",
  "buildings.html",
  "settings.html",
  "offline.html",
  "manifest.json",
  "assets/css/styles.css",
  "assets/js/app.js",
  "assets/images/cropped-logo.jpg",
  "assets/images/Quezon_City_Government.png",
  "assets/images/QCU-BUILDING-1024x683-1.jpg",
  "assets/images/Belmonte Building 2.jpg",
  "assets/images/New Academic building(1).jpg",
  "assets/images/Techboc HB bautista.jpg",
  "data/schedule.json",
  "data/buildings.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
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
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
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
