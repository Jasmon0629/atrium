import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Deploys can live under a URL prefix (e.g. /atrium/ behind a reverse proxy)
  base: process.env.ATRIUM_BASE || '/',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Vendor code changes rarely; keeping it in its own fingerprinted chunks
        // means a routine deploy only re-downloads the (small) app chunk.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', 'scheduler'],
          motion: ['motion'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          socket: ['socket.io-client'],
        },
      },
    },
  },
  server: {
    port: 5100,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4600',
      '/socket.io': { target: 'http://localhost:4600', ws: true },
    },
  },
});
