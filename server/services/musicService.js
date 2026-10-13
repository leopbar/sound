/**
 * A "Ponte": MusicBrainz (metadados) -> YouTube (áudio) -> Jamendo/Internet Archive (fallback).
 */
const config = require('../config');
const { remember, TTL } = require('../lib/cache');
const { normalize, mapLimit } = require('../lib/text');
const { searchRecordings } = require('./musicbrainz');
const { findVideoForTrack, searchVideos } = require('./youtube');
const { findFallbackForTrack, freeSearch } = require('./fallbacks');

// Cada busca no YouTube leva ~0,5-1s; resolvendo todas em paralelo, o tempo total
// é o da mais lenta, não a soma de várias rodadas.
const RESOLVE_CONCURRENCY = Number(process.env.RESOLVE_CONCURRENCY) || 12;

// O Internet Archive pode levar vários segundos (busca + metadados do item). Na busca,
// não deixamos uma faixa sem YouTube segurar a resposta inteira: após o teto ela é
// omitida, mas a consulta continua em segundo plano e fica no cache para a próxima vez.
const FALLBACK_TIMEOUT_MS = Number(process.env.FALLBACK_TIMEOUT_MS) || 1500;

// A MusicBrainz não sabe o que é popular: versões da mesma música empatam em relevância.
// As views do vídeo escolhido desempatam na escala log (cada 10x mais views = +N pontos),
// para não deixar a popularidade atropelar a relevância (ex.: subir um cover viral).
const POPULARITY_WEIGHT = Number(process.env.POPULARITY_WEIGHT) || 10;

// Quantas faixas do ranking preliminar (consulta de estúdio) adiantar no YouTube.
const EARLY_RESOLVE = 6;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => (timer = setTimeout(() => resolve(null), ms))),
  ]);
}

async function resolveAudio(track) {
  try {
    const video = await findVideoForTrack(track);
    if (video) {
      return {
        source: 'youtube',
        sourceId: video.videoId,
        streamUrl: `/api/stream/${video.videoId}`,
        // Capa do álbum (Cover Art Archive) tem prioridade; a do vídeo é reserva.
        fallbackThumbnail: video.thumbnail,
        duration: video.duration || track.duration, // o player toca o vídeo, não a gravação
        views: video.views || 0,
      };
    }
  } catch (err) {
    console.warn(`[music] YouTube falhou para "${track.artist} - ${track.title}":`, err.message);
  }

  const alt = await withTimeout(findFallbackForTrack(track).catch(() => null), FALLBACK_TIMEOUT_MS);
  if (alt) {
    return {
      source: alt.source,
      sourceId: alt.sourceId,
      streamUrl: alt.streamUrl,
      fallbackThumbnail: alt.thumbnail,
      duration: track.duration || alt.duration,
    };
  }
  return null;
}

/**
 * Retorna objetos unificados:
 * { id, title, artist, album, thumbnail, fallbackThumbnail, duration, isrc, mbid, source, sourceId, streamUrl }
 */
async function search(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  return remember(`search:${normalize(q)}`, TTL.METADATA, async () => {
    // Adianta o YouTube das prováveis primeiras faixas; findVideoForTrack é cacheado e
    // deduplicado por mbid, então a resolução definitiva abaixo reaproveita o trabalho.
    const recordings = await searchRecordings(q, config.searchLimit, {
      onEarly: (early) => early.slice(0, EARLY_RESOLVE).forEach((rec) => findVideoForTrack(rec).catch(() => {})),
    });

    if (!recordings.length) return freeSearch(q, config.searchLimit);

    const resolved = await mapLimit(recordings, RESOLVE_CONCURRENCY, async (rec) => {
      const audio = await resolveAudio(rec);
      if (!audio) return null;
      return {
        id: `${audio.source}:${audio.sourceId}`,
        kind: 'recording',
        mbid: rec.mbid,
        title: rec.title,
        version: rec.version, // desambiguação MB, ex.: "live, 1986-07-12: Wembley Stadium"
        artist: rec.artist,
        album: rec.album,
        isrc: rec.isrc,
        thumbnail: rec.coverArt || audio.fallbackThumbnail,
        fallbackThumbnail: audio.fallbackThumbnail,
        duration: audio.duration,
        source: audio.source,
        sourceId: audio.sourceId,
        streamUrl: audio.streamUrl,
        views: audio.views || 0,
        relevance: rec.rank + POPULARITY_WEIGHT * Math.log10(1 + (audio.views || 0)),
      };
    });

    // Gravações diferentes podem cair no mesmo vídeo; mantemos a mais relevante.
    const seen = new Set();
    return resolved
      .filter(Boolean)
      .sort((a, b) => b.relevance - a.relevance)
      .filter((t) => !seen.has(t.id) && seen.add(t.id))
      .map(({ relevance, ...t }) => t);
  });
}

// Aba "YouTube": vídeos curtos demais (Shorts) ou longos demais (álbuns/compilações
// inteiros, lives) não são "uma música".
const VIDEO_MIN_S = 30;
const VIDEO_MAX_S = 20 * 60;

/**
 * Resultados "como o YouTube mostra": vídeos na ordem do próprio YouTube, sem passar
 * pela MusicBrainz. Mesmo formato unificado, com kind: 'video'.
 */
async function searchYouTube(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  return remember(`ytsearch:${normalize(q)}`, TTL.METADATA, async () => {
    const videos = await searchVideos(q, { limit: 24 });
    return videos
      .filter((v) => v.duration >= VIDEO_MIN_S && v.duration <= VIDEO_MAX_S)
      .map((v) => ({
        id: `youtube:${v.videoId}`,
        kind: 'video',
        title: v.title,
        artist: v.channel,
        album: null,
        // mqdefault é 16:9 sem as faixas pretas do hqdefault (4:3).
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
        fallbackThumbnail: v.thumbnail,
        duration: v.duration,
        views: v.views || 0,
        source: 'youtube',
        sourceId: v.videoId,
        streamUrl: `/api/stream/${v.videoId}`,
      }));
  });
}

module.exports = { search, searchYouTube };
