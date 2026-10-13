import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
