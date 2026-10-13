import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH: subcaminho onde o app é publicado (ex.: /sound na VPS). Vazio = raiz.
const basePath = (process.env.BASE_PATH || '').replace(/\/+$/, '');

export default defineConfig({
  base: `${basePath}/`,
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Mesma origem para o <audio>: evita CORS e permite a Web Audio API ler as amostras.
      '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:4000', changeOrigin: true },
    },
  },
});
