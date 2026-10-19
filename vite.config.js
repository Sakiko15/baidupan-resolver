import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { fileURLToPath } from 'node:url';

const rootDir = import.meta.dirname || fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://mxd.indevs.in',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        home: resolve(rootDir, 'home.html'),
        history: resolve(rootDir, 'history.html'),
      },
    },
  },
});
