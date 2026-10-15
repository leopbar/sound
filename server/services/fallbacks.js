/**
 * Fontes alternativas de áudio. A busca hoje é só no YouTube, mas faixas do Jamendo
 * (e do Internet Archive, que não precisa de nada daqui) ainda podem estar salvas em
 * playlists e continuam tocando.
 */
const axios = require('axios');
const config = require('../config');
const { remember, TTL } = require('../lib/cache');

/** URL do MP3 de uma faixa do Jamendo — requer JAMENDO_CLIENT_ID. */
async function jamendoAudioUrl(trackId) {
  if (!config.jamendoClientId) return null;
  return remember(`jamendo:audio:${trackId}`, TTL.STREAM_INFO, async () => {
    const { data } = await axios.get('https://api.jamendo.com/v3.0/tracks/', {
      timeout: 8000,
      params: { client_id: config.jamendoClientId, format: 'json', id: trackId, audioformat: 'mp32' },
    });
    return data.results?.[0]?.audio || null;
  });
}

module.exports = { jamendoAudioUrl };
