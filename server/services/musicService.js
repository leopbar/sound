/**
 * Busca de músicas: vídeos do YouTube na ordem do próprio YouTube.
 */
const { remember, TTL } = require('../lib/cache');
const { normalize } = require('../lib/text');
const { searchVideos } = require('./youtube');

// Vídeos curtos demais (Shorts) ou longos demais (álbuns/compilações inteiros, lives)
// não são "uma música".
const VIDEO_MIN_S = 30;
const VIDEO_MAX_S = 20 * 60;

/**
 * Retorna objetos unificados:
 * { id, kind: 'video', title, artist, album, thumbnail, fallbackThumbnail, duration, views, source, sourceId, streamUrl }
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

module.exports = { searchYouTube };
