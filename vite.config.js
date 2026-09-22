import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api/textverified -> TextVerified's v2 API so local dev
// mirrors production (where server.js does the same). TextVerified blocks browser CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/textverified': {
        target: 'https://www.textverified.com',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api\/textverified/, '/api/pub/v2'),
      },
    },
  },
});
