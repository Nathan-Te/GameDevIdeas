import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En développement le front est servi par Vite et l'API par Fastify sur 3000.
    // Le proxy garde une origine unique, donc les mêmes URL qu'en production.
    //
    // `/files` compte autant que `/api` : les images attachées et les markdown
    // sont servis par Fastify depuis `data/files/`. Sans cette ligne, Vite
    // répond son propre `index.html` sur toute adresse inconnue — une image
    // reste donc cassée et un markdown s'affiche… en HTML de la page d'accueil.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/files': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
