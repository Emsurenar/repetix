import { defineConfig } from 'vite';
import { apiPlugin } from './vite-plugin-api.js';

export default defineConfig({
  // Kör api/*.js som middleware i utvecklingsservern, så att samma handlers
  // körs lokalt som på Vercel. Pluginen gäller bara vid `vite` och rör varken
  // bygget eller testkörningen.
  plugins: [apiPlugin()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
