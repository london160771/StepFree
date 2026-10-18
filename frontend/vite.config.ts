import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // MapLibre GL is one lazily loaded chunk of about 1 MB (about 290 KB gzipped).
  build: { chunkSizeWarningLimit: 1200 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'StepFree',
        short_name: 'StepFree',
        description:
          'An accessibility journey agent for 17 London Underground stations, with step-free routing, disruption-aware rerouting and Plan B.',
        lang: 'en-GB',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f3f1ec',
        theme_color: '#f3f1ec',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell only. Routes and live TfL lift data always come from the API over the network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
