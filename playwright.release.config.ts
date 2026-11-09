import { defineConfig } from '@playwright/test';

// Release checks: the real desktop app (Electron) on `dist`, and the single-file edition in `dist-single`.
// Build both first: `npm run build && npm run build:single`.
export default defineConfig({
  testDir: 'tests/release',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
});
