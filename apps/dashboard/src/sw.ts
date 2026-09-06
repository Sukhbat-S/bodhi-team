/// <reference lib="webworker" />

// Compatibility source for the self-destroying worker emitted by vite.config.
// It exists only to retire older cached dashboard workers. It provides no
// offline cache, notification, or background behavior.
const worker = globalThis as unknown as ServiceWorkerGlobalScope;

worker.addEventListener("install", () => worker.skipWaiting());
worker.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      worker.registration.unregister(),
      worker.caches.keys().then((keys) => Promise.all(keys.map((key) => worker.caches.delete(key)))),
    ]).then(() => undefined),
  );
});
