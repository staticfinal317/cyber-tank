import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

function publicAssets(directory: URL, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? publicAssets(new URL(`${entry.name}/`, directory), relative) : [`./${relative}`];
  });
}

export function createServiceWorkerSource(precache: string[], cacheVersion: string): string {
  return `const CACHE_PREFIX = 'cyber-tank-shell-';
const CACHE = CACHE_PREFIX + ${JSON.stringify(cacheVersion)};
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) event.waitUntil(caches.open(CACHE).then((cache) => cache.put('./index.html', response.clone())));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, response.clone())));
    return response;
  })));
});
`;
}

function offlineFamilyServiceWorker(): Plugin {
  return {
    name: 'cyber-tank-offline-family-service-worker',
    generateBundle(_, bundle) {
      const generated = Object.keys(bundle).filter((file) => file !== 'sw.js').map((file) => `./${file}`);
      const publicDir = new URL('./public/', import.meta.url);
      const files = [...new Set(['./', './index.html', ...generated, ...publicAssets(publicDir)])].sort();
      const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: createServiceWorkerSource(files, version) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineFamilyServiceWorker()],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
