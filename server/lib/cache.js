const NodeCache = require('node-cache');

// TTLs em segundos
const TTL = {
  METADATA: 60 * 60, // MusicBrainz: 1h (requisito)
  YOUTUBE: 60 * 60 * 24, // mapeamento recording -> vídeo: 24h
  STREAM_INFO: 60 * 60 * 4, // URLs do googlevideo expiram em ~6h
};

const cache = new NodeCache({ stdTTL: TTL.METADATA, checkperiod: 120, useClones: false });

/** Retorna do cache ou executa `fn`, armazenando o resultado. Deduplica chamadas concorrentes. */
const inflight = new Map();
async function remember(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await fn();
      // Resultados vazios não são cacheados: podem ser falhas transitórias.
      if (value != null && !(Array.isArray(value) && !value.length)) cache.set(key, value, ttl);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

module.exports = { cache, remember, TTL };
