import { describe, expect, it } from 'vitest';
import { createServiceWorkerSource } from '../vite.config';

describe('offline family service worker', () => {
  it('pre-caches versioned production assets and keeps runtime writes alive', () => {
    const source = createServiceWorkerSource(
      ['./', './index.html', './assets/app-123.js', './assets/app-123.css', './fonts/ui.woff2', './assets/models/tank.glb'],
      'abc123',
    );
    expect(source).toContain("CACHE_PREFIX + \"abc123\"");
    expect(source).toContain('./assets/app-123.js');
    expect(source).toContain('./fonts/ui.woff2');
    expect(source).toContain('./assets/models/tank.glb');
    expect(source).toContain("event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, response.clone())))");
    expect(source).not.toContain("cached ?? caches.match('./index.html')");
  });
});
