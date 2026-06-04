"use strict";

/* ===== CONFIG ===== */
const CACHE_VERSION = "ms-cache-v1.5.9";
const OFFLINE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./favicon.ico",
  "./favicon.png"
];

/* ===== INSTALL ===== */
self.addEventListener("install", event => {
  self.skipWaiting(); // activate immediately
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      return cache.addAll(OFFLINE_ASSETS);
    })
  );
});

/* ===== ACTIVATE ===== */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_VERSION) {
            return caches.delete(key); // remove old versions
          }
        })
      )
    )
  );
  self.clients.claim(); // control all open tabs
});

/* ===== FETCH ===== */
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          // Cache new files dynamically
          if (
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => {
              cache.put(event.request, copy);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline fallback
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        });
    })
  );
});
