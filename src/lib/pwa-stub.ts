// Stands in for `virtual:pwa-register` in builds without a service worker (single-file edition).
export function registerSW() {
  return () => Promise.resolve();
}
