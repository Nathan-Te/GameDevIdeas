import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En développement le front est servi par Vite et l'API par Fastify sur 3000.
    // Le proxy garde une origine unique, donc les mêmes URL `/api/...` qu'en production.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
