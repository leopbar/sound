/**
 * Mais tocadas no mundo: playlist oficial "Top 50 - Global" do Spotify, lida da página de
 * incorporação (open.spotify.com/embed, sem chave; a Web API não entrega playlists editoriais a
 * apps novos). Cada música é associada a um vídeo do YouTube pela busca, conferindo a duração.
 * Se a página mudar, a rota responde erro e o cliente mostra "tentar de novo".
 */
const axios = require('axios');
const { remember } = require('../lib/cache');
const { normalize, tokenCoverage } = require('../lib/text');
const { searchVideos } = require('./youtube');

const PLAYLIST_ID = '37i9dQZEVXbMDoHDwVN2tF'; // Top 50 - Global
const CHART_TTL = 6 * 60 * 60; // a playlist muda 1×/dia
const MATCH_TTL = 7 * 24 * 60 * 60; // a mesma música fica semanas na lista
const LIMIT = 30;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchPlaylist() {
  const { data: html } = await axios.get(`https://open.spotify.com/embed/playlist/${PLAYLIST_ID}`, {
    timeout: 10_000,
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
    responseType: 'text',
  });
  const m = /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s.exec(html);
  const list = m && JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity?.trackList;
  if (!Array.isArray(list) || !list.length) throw new Error('spotify embed format changed');
  return list
    .filter((t) => t.entityType === 'track' && t.title && t.subtitle)
    .map((t) => ({
      spotifyId: String(t.uri || '').split(':').pop(),
      title: t.title,
      artist: t.subtitle,
      duration: t.duration > 0 ? Math.round(t.duration / 1000) : null,
    }));
}

// Versões que não são a gravação original (só valem se o título da música também as tiver).
const UNWANTED = ['live', 'ao vivo', 'cover', 'karaoke', 'instrumental', 'remix', 'sped up', 'slowed', 'reverb', 'nightcore', '8d', 'lyrics', 'letra', 'tradução', 'legendado', 'reaction', 'piano'];

/** Nota do vídeo como versão da música; null = não serve. */
function scoreVideo(song, mainArtist, v) {
  if (song.duration && Math.abs(v.duration - song.duration) > 20) return null;
  const songTitle = normalize(song.title.replace(/\s*[([].*?[)\]]/g, ''));
  const vTitle = normalize(v.title);
  const channel = normalize(v.channel);
  if (tokenCoverage(songTitle, vTitle) < 0.6) return null;

  let score = 0;
  if (song.duration) score += 10 - Math.abs(v.duration - song.duration) / 2;
  if (/ topic$/.test(channel)) score += 8; // "Artista - Topic": só o áudio oficial
  if (tokenCoverage(mainArtist, `${channel} ${vTitle}`) >= 0.6) score += 5;
  const original = normalize(song.title);
  for (const w of UNWANTED) {
    if (new RegExp(`\b${w}\b`).test(vTitle) && !new RegExp(`\b${w}\b`).test(original)) score -= 15;
  }
  return score;
}

/** Melhor vídeo do YouTube para a música (cache por música). */
function matchVideo(song) {
  return remember(`chartmatch:${song.spotifyId}`, MATCH_TTL, async () => {
    const mainArtist = song.artist.split(',')[0].trim();
    const title = song.title.replace(/\s*\((?:feat|with|ft)\.?[^)]*\)/i, '');
    const videos = await searchVideos(`${mainArtist} - ${title}`, { limit: 10 });
    let best = null;
    for (const v of videos) {
      const score = scoreVideo(song, mainArtist, v);
      if (score != null && (!best || score > best.score)) best = { score, v };
    }
    return best?.v || null;
  });
}

/** Executa `fn` em `items` com no máximo `n` chamadas ao mesmo tempo. */
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]).catch(() => null);
      }
    })
  );
  return out;
}

async function fetchGlobalChart() {
  const songs = await fetchPlaylist();
  const tracks = [];
  // Busca em lotes até completar 30 (alguma música pode ficar sem vídeo correspondente).
  for (let i = 0; i < songs.length && tracks.length < LIMIT; i += LIMIT - tracks.length) {
    const batch = songs.slice(i, i + LIMIT - tracks.length);
    const videos = await mapLimit(batch, 5, matchVideo);
    batch.forEach((song, j) => {
      const v = videos[j];
      if (!v) return;
      tracks.push({
        id: `youtube:${v.videoId}`,
        kind: 'song',
        title: song.title,
        artist: song.artist,
        album: null,
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        fallbackThumbnail: v.thumbnail,
        duration: song.duration || v.duration,
        views: 0,
        rank: i + j + 1,
        source: 'youtube',
        sourceId: v.videoId,
        streamUrl: `/api/stream/${v.videoId}`,
      });
    });
  }
  if (!tracks.length) throw new Error('no chart track matched a video');
  return { updatedAt: new Date().toISOString().slice(0, 10), tracks };
}

/** { updatedAt: 'AAAA-MM-DD', tracks: [...] } — as 30 primeiras da Top 50 - Global do Spotify. */
const getGlobalTop = () => remember('chart:spotify:global', CHART_TTL, fetchGlobalChart);

module.exports = { getGlobalTop };
