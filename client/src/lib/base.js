/**
 * Caminho onde o app é servido: '/' no local, '/sound/' em https://seudominio.com/sound.
 * Vem do `base` do Vite (variável BASE_PATH no build). Termina sempre com '/'.
 */
export const APP_BASE = import.meta.env.BASE_URL;

/** Prefixo das chamadas à API: '' no local, '/sound' na VPS. */
export const API_BASE = import.meta.env.VITE_API_URL || APP_BASE.replace(/\/$/, '');

/** Caminho absoluto dentro do app: appPath('reset-password') -> '/sound/reset-password'. */
export const appPath = (path = '') => APP_BASE + path.replace(/^\/+/, '');
