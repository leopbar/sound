import { create } from 'zustand';

/**
 * Instalação como app (PWA). O Chrome dispara `beforeinstallprompt` uma vez, cedo (às vezes antes
 * do login), então o evento é capturado aqui no carregamento do módulo e guardado no store.
 * No iPhone não existe esse evento: lá a instalação é manual (Compartilhar → Tela de Início).
 */
const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Pode mostrar o botão: há prompt nativo, ou é iOS (mostra instruções). */
export const selectCanInstall = (s) => !s.installed && (!!s.promptEvent || s.isIOS);

export const usePwaStore = create((set, get) => ({
  promptEvent: null,
  installed: standalone(),
  isIOS,
  /** Abre o diálogo nativo. Retorna 'accepted' | 'dismissed' | 'ios' (mostrar instruções). */
  install: async () => {
    const evt = get().promptEvent;
    if (!evt) return isIOS ? 'ios' : 'dismissed';
    evt.prompt();
    const { outcome } = await evt.userChoice;
    // O evento só pode ser usado uma vez; o Chrome dispara outro se ainda fizer sentido.
    set({ promptEvent: null });
    return outcome;
  },
}));

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // nós mostramos o nosso botão
  usePwaStore.setState({ promptEvent: e });
});
window.addEventListener('appinstalled', () => usePwaStore.setState({ installed: true, promptEvent: null }));
window.matchMedia('(display-mode: standalone)').addEventListener?.('change', (e) => {
  if (e.matches) usePwaStore.setState({ installed: true });
});

/** Registra o service worker (só no build de produção: em dev atrapalharia o hot reload). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker:', err));
  });
}
