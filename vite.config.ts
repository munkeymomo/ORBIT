/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// `vite build --mode single` makes the single-file edition: one HTML file with everything inlined,
// no service worker, for opening straight from disk.
export default defineConfig(({ mode }) => ({
  // Relative base so the build runs from any static host, a sub-path, or the desktop app.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve:
    mode === 'single' ? { alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/lib/pwa-stub.ts', import.meta.url)) } } : undefined,
  build: mode === 'single' ? { outDir: 'dist-single', emptyOutDir: true } : undefined,
  plugins: [
    react(),
    tailwindcss(),
    mode === 'single' && {
      // the favicon too, so the file needs nothing beside it
      name: 'orbit-inline-icons',
      transformIndexHtml: (html: string) =>
        html
          .replace(
            'href="./favicon.svg"',
            `href="data:image/svg+xml;base64,${readFileSync(new URL('./public/favicon.svg', import.meta.url)).toString('base64')}"`,
          )
          .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, ''),
    },
    mode === 'single'
      ? viteSingleFile({ removeViteModuleLoader: true })
      : VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered manually in src/lib/pwa.ts, guarded for sandboxed frames
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'ORBIT — Visual Workspace',
        short_name: 'ORBIT',
        description: 'See your work, never lose your place, make starting easy.',
        theme_color: '#0A0C12',
        background_color: '#0A0C12',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
}));
