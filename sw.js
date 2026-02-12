const CACHE = "offline-cache";
const OFFLINE_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_FILES))
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
