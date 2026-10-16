import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Generates the PWA icons in public/ from public/icon.svg: npm run icons
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.1, resizeOptions: { background: '#0f766e' } },
    apple: { ...minimal2023Preset.apple, padding: 0.1, resizeOptions: { background: '#0f766e' } },
  },
  images: ['public/icon.svg'],
});
