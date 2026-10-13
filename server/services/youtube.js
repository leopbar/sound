const axios = require('axios');
const config = require('../config');
const { remember, TTL } = require('../lib/cache');
const { normalize, tokenCoverage, parseIsoDuration, parseClock } = require('../lib/text');

const NEGATIVE = ['live', 'cover', 'karaoke', 'instrumental', 'reaction', 'remix', 'lyrics', 'tutorial', 'lesson', 'slowed', 'reverb', 'nightcore', '8d', 'sped up', 'piano', 'guitar'];

// Se a cota da Data API acabar, usamos a busca interna até esse instante.
let apiDisabledUntil = 0;

/* ------------------------------------------------------------------ */
/* Provedores de busca                                                 */
/* ------------------------------------------------------------------ */

async function searchViaDataApi(q, limit) {
  const search = await axios.get('https://www.googleapis.com/youtube/v3/search', {
    timeout: 8000,
    params: { key: config.youtubeApiKey, part: 'snippet', type: 'video', maxResults: limit, q },
  });
  const items = search.data.items || [];
  if (!items.length) return [];

  // search.list não traz duração nem views; videos.list custa só 1 unidade de cota.
  const details = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    timeout: 8000,
    params: {
      key: config.youtubeApiKey,
      part: 'contentDetails,statistics',
      id: items.map((i) => i.id.videoId).join(','),
    },
  });
  const byId = Object.fromEntries((details.data.items || []).map((v) => [v.id, v]));

  return items.map((i) => ({
    videoId: i.id.videoId,
    title: decodeEntities(i.snippet.title),
    channel: i.snippet.channelTitle,
    duration: parseIsoDuration(byId[i.id.videoId]?.contentDetails?.duration),
    views: Number(byId[i.id.videoId]?.statistics?.viewCount) || 0,
    thumbnail: i.snippet.thumbnails?.high?.url || i.snippet.thumbnails?.default?.url,
  }));
}

const VIDEOS_ONLY = 'EgIQAQ=='; // filtro de busca: somente vídeos
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Busca "interna" sem chave/cota. Primeiro via API JSON interna do site (innertube):
 * resposta ~4x menor e ~30% mais rápida que a página HTML. Se ela mudar, cai no
 * parse do ytInitialData da página de resultados.
 */
async function searchViaScrape(q, limit) {
  try {
    const { data } = await axios.post(
      'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
      {
        context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' } },
        query: q,
        params: VIDEOS_ONLY,
      },
      { timeout: 8000, headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA } }
    );
    const videos = extractVideos(data, limit);
    if (videos.length) return videos;
  } catch (err) {
    console.warn('[youtube] innertube falhou, usando página HTML:', err.message);
  }

  const { data: html } = await axios.get('https://www.youtube.com/results', {
    timeout: 10_000,
    params: { search_query: q, sp: VIDEOS_ONLY },
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' },
    responseType: 'text',
  });

  const m = /(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*(\{.+?\});\s*<\/script>/s.exec(html);
  if (!m) throw new Error('ytInitialData not found');
  return extractVideos(JSON.parse(m[1]), limit);
}

/** Percorre a resposta (innertube ou ytInitialData) coletando os videoRenderer. */
function extractVideos(root, limit) {
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object' || out.length >= limit) return;
    if (node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      out.push({
        videoId: v.videoId,
        title: v.title?.runs?.map((r) => r.text).join('') || '',
        channel: v.ownerText?.runs?.[0]?.text || '',
        duration: parseClock(v.lengthText?.simpleText),
        // "2,850,226 views" (hl=en); "No views" -> 0
        views: Number(String(v.viewCountText?.simpleText || '').replace(/\D/g, '')) || 0,
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      });
      return;
    }
    for (const k in node) walk(node[k]);
  })(root);
  return out.filter((v) => v.duration); // descarta lives sem duração
}

/** Busca vídeos no YouTube, na ordem de relevância do próprio YouTube. */
async function searchVideos(q, { limit = 10 } = {}) {
  if (config.youtubeApiKey && Date.now() > apiDisabledUntil) {
    try {
      return await searchViaDataApi(q, limit);
    } catch (err) {
      const reason = err.response?.data?.error?.errors?.[0]?.reason;
      if (['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'keyInvalid'].includes(reason)) {
        apiDisabledUntil = Date.now() + 60 * 60 * 1000;
        console.warn(`[youtube] Data API indisponível (${reason}); usando busca interna por 1h.`);
      } else {
        console.warn('[youtube] Data API falhou:', err.message);
      }
    }
  }
  return searchViaScrape(q, limit);
}

/* ------------------------------------------------------------------ */
/* Casamento gravação MusicBrainz <-> vídeo                            */
/* ------------------------------------------------------------------ */

function scoreCandidate(track, v) {
  const title = normalize(v.title);
  const channel = normalize(v.channel);
  const wanted = normalize(`${track.title} ${track.album || ''} ${track.version || ''}`);
  let s = 0;

  s += 40 * tokenCoverage(track.title, v.title);
  s += 25 * Math.max(tokenCoverage(track.artist, v.title), tokenCoverage(track.artist, v.channel));
  if (channel.endsWith(' topic')) s += 20; // canais "Artista - Topic" = áudio de estúdio oficial
  if (/\bofficial\b/.test(title)) s += 8;
  if (/\bvevo\b/.test(channel)) s += 8;

  for (const word of NEGATIVE) {
    if (new RegExp(`\\b${word}\\b`).test(title) && !wanted.includes(word)) s -= 25;
  }

  if (track.duration && v.duration) {
    const diff = Math.abs(track.duration - v.duration);
    if (diff <= 3) s += 25;
    else if (diff <= 10) s += 15;
    else if (diff > 30) s -= Math.min(60, diff / 2); // clipes com intro longa, compilações etc.
  }
  return s;
}

const MIN_SCORE = 35;
// Candidatos até esta distância do melhor score são considerados "equivalentes";
// entre eles vence o mais assistido. Penalidades (ao vivo, cover, duração errada)
// valem 25+ pontos, então versões erradas ficam fora da janela.
const POPULARITY_WINDOW = 15;

/** Encontra o melhor vídeo para uma gravação. Resultado em cache por 24h. */
async function findVideoForTrack(track) {
  const key = `yt:match:${track.mbid || normalize(`${track.artist} ${track.title}`)}`;
  return remember(key, TTL.YOUTUBE, async () => {
    const live = /\blive\b/i.test(track.version || '') ? ' live' : '';
    const candidates = await searchVideos(`${track.artist} - ${track.title}${live} audio`);
    const scored = candidates
      .map((v) => ({ ...v, score: scoreCandidate(track, v) }))
      .sort((a, b) => b.score - a.score);
    const top = scored[0]?.score;
    if (top === undefined || top < MIN_SCORE) return null;
    const floor = Math.max(MIN_SCORE, top - POPULARITY_WINDOW);
    return scored
      .filter((v) => v.score >= floor)
      .reduce((best, v) => ((v.views || 0) > (best.views || 0) ? v : best));
  });
}

function decodeEntities(s = '') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

module.exports = { findVideoForTrack, searchVideos };
