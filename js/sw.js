const CACHE_NAME = "codivex-shell-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",

  "./css/style.css",

  "./js/main.js",
  "./js/db.js",
  "./js/editor.js",
  "./js/explorer.js",
  "./js/icons.js",
  "./js/lint.js",
  "./js/preview.js",
  "./js/zip.js",
  "./js/ai.js",
  "./js/onedrive.js",
  "./js/terminal.js",
  "./js/settings.js",
  "./js/pwa.js",

  "./imag/icone_app.jpeg",
  "./imag/icone_navegador.jpeg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  // Não intercepta recursos externos, como CDN.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, copy);
          });
        }

        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});