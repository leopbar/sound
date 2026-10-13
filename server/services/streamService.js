/**
 * Proxy de streaming de áudio.
 *  - YouTube: ytdl-core (fork @distube/ytdl-core), audioonly / highestaudio, com
 *    yt-dlp como extrator de reserva. Suporta HTTP Range para o <audio> fazer seek.
 *  - Jamendo / Internet Archive: proxy HTTP simples com repasse de Range.
 */
const axios = require('axios');
const NodeCache = require('node-cache');
const ytdl = require('@distube/ytdl-core');
const { TTL } = require('../lib/cache');
const { HttpError } = require('../lib/errors');
const { jamendoAudioUrl } = require('./fallbacks');
const ytdlp = require('./ytdlp');

// Objetos `info` são grandes; cache dedicado com limite de entradas.
const infoCache = new NodeCache({ stdTTL: TTL.STREAM_INFO, maxKeys: 300, useClones: false });

let agent;
if (process.env.YT_COOKIES) {
  try {
    // Formato: array JSON exportado pela extensão "EditThisCookie" / "Cookie-Editor".
    agent = ytdl.createAgent(JSON.parse(process.env.YT_COOKIES));
    console.log('[stream] usando cookies do YouTube');
  } catch (e) {
    console.warn('[stream] YT_COOKIES inválido:', e.message);
  }
}

/* ------------------------------------------------------------------ */
/* Classificação de erros do ytdl                                      */
/* ------------------------------------------------------------------ */

const ERROR_PATTERNS = [
  [/private video|video is private/i, 'VIDEO_PRIVATE', 'O vídeo é privado.'],
  [/not available in your country|blocked it in your country|region/i, 'REGION_BLOCKED', 'O vídeo está bloqueado nesta região.'],
  [/removed|terminated|no longer available|does not exist|video unavailable/i, 'VIDEO_REMOVED', 'O vídeo foi removido ou está indisponível.'],
  [/confirm your age|age-restricted|inappropriate/i, 'AGE_RESTRICTED', 'O vídeo tem restrição de idade.'],
  [/not a bot|sign in to confirm/i, 'BOT_CHECK', 'O YouTube exigiu verificação anti-bot (configure YT_COOKIES).'],
  [/copyright/i, 'COPYRIGHT_BLOCKED', 'O vídeo foi bloqueado por direitos autorais.'],
  [/status code: 429|too many requests/i, 'UPSTREAM_RATE_LIMITED', 'O YouTube limitou as requisições temporariamente.'],
  [/no such format|no formats/i, 'NO_AUDIO_FORMAT', 'Nenhum formato de áudio disponível.'],
];

function toStreamError(err, videoId) {
  if (err instanceof HttpError) return err;
  const msg = err?.message || String(err);
  const hit = ERROR_PATTERNS.find(([re]) => re.test(msg));
  const [, code, message] = hit || [null, 'STREAM_FAILED', 'Falha ao obter o áudio.'];
  return new HttpError(502, code, message, { videoId, reason: msg, tryNext: true });
}

/* ------------------------------------------------------------------ */
/* Range                                                               */
/* ------------------------------------------------------------------ */

/** Interpreta "bytes=start-end". Retorna null se ausente/ inválido ou {start,end}. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || !size) return null;
  let start;
  let end;
  if (m[1] === '') {
    // sufixo: últimos N bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

// Erros definitivos: não adianta tentar outro extrator.
const FATAL = new Set(['VIDEO_PRIVATE', 'VIDEO_REMOVED', 'REGION_BLOCKED', 'COPYRIGHT_BLOCKED']);
let ytdlBrokenUntil = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * O axios usa o follow-redirects, que deixa no socket um timeout de inatividade que o destrói
 * mesmo depois de a resposta chegar. Quando o <audio> para de ler (buffer cheio, tela bloqueada),
 * a origem fica parada e a conexão cairia no meio da música. O `timeout` continua valendo até a
 * resposta; daí em diante, sem limite.
 */
function keepOpen(response) {
  response.request?.socket?.setTimeout(0);
  return response;
}

const MAX_AVAILABILITY_WAIT_MS = 10_000;
const AVAILABILITY_GRACE_MS = 3000;

/**
 * URLs recentes do googlevideo têm um "available_at": pedidos anteriores recebem 403.
 * Espera até lá (com pequena margem), limitado a 10s para não prender a conexão.
 */
async function waitUntilAvailable(entry) {
  const wait = entry.availableAt ? entry.availableAt + 300 - Date.now() : 0;
  if (wait > 0) await sleep(Math.min(wait, MAX_AVAILABILITY_WAIT_MS));
}

/** Pré-resolve as fontes das primeiras faixas para o primeiro play ser imediato. */
function prefetch(videoIds) {
  for (const id of videoIds) getAudioSource(id).catch(() => {});
}

/**
 * Resolve a fonte de áudio de um vídeo:
 *  1. ytdl-core (audioonly / highestaudio);
 *  2. se falhar por motivo não definitivo (ex.: mudança no player do YouTube), yt-dlp.
 * O resultado fica em cache (as URLs do googlevideo valem ~6h).
 */
const inflight = new Map();
function getAudioSource(videoId) {
  const cached = infoCache.get(videoId);
  if (cached) return Promise.resolve(cached);
  // Prefetch e play simultâneos compartilham a mesma resolução.
  if (!inflight.has(videoId)) {
    inflight.set(videoId, resolveSource(videoId).finally(() => inflight.delete(videoId)));
  }
  return inflight.get(videoId);
}

async function resolveSource(videoId) {
  let entry;
  try {
    // Circuit breaker: se o ytdl-core falhou há pouco por motivo não definitivo
    // (tipicamente quebra após mudança no YouTube), vai direto ao yt-dlp.
    if (Date.now() < ytdlBrokenUntil) throw new Error('ytdl-core circuit open');
    const info = await ytdl.getInfo(videoId, agent ? { agent } : {});
    const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
    entry = {
      kind: 'ytdl',
      info,
      format,
      mime: (format.mimeType || 'audio/webm').split(';')[0],
      size: Number(format.contentLength) || 0,
    };
  } catch (ytdlErr) {
    const classified = toStreamError(ytdlErr, videoId);
    if (FATAL.has(classified.code) || !(await ytdlp.isAvailable())) throw classified;
    if (Date.now() >= ytdlBrokenUntil) {
      ytdlBrokenUntil = Date.now() + 10 * 60 * 1000;
      console.warn(`[stream] ytdl-core falhou para ${videoId} (${ytdlErr.message}); usando yt-dlp por 10 min.`);
    }
    try {
      entry = { kind: 'direct', ...(await ytdlp.resolveAudio(videoId)) };
    } catch (err) {
      throw toStreamError(err, videoId);
    }
  }

  try {
    infoCache.set(videoId, entry);
  } catch {
    infoCache.flushAll(); // maxKeys atingido
    infoCache.set(videoId, entry);
  }
  return entry;
}

async function streamYouTube(videoId, req, res, retry = true) {
  if (!ytdl.validateID(videoId)) {
    throw new HttpError(400, 'INVALID_VIDEO_ID', 'ID de vídeo inválido.', { videoId });
  }

  const entry = await getAudioSource(videoId);
  const { size, mime } = entry;
  const range = parseRange(req.headers.range, size);

  if (range === 'unsatisfiable') {
    res.status(416).setHeader('Content-Range', `bytes */${size}`);
    return res.end();
  }

  const { start, end } = range || { start: 0, end: size - 1 };
  const invalidate = () => infoCache.del(videoId); // URL expirada/negada: re-resolve na próxima

  let stream;
  if (entry.kind === 'ytdl') {
    const options = { format: entry.format, highWaterMark: 1 << 25, ...(agent ? { agent } : {}) };
    if (size) options.range = { start, end };
    stream = ytdl.downloadFromInfo(entry.info, options);
  } else {
    // URL direta do googlevideo: sempre pedimos um intervalo explícito (evita throttling).
    const fetchUpstream = () =>
      axios
        .get(entry.url, {
          responseType: 'stream',
          timeout: 15_000,
          headers: { ...entry.headers, ...(size ? { Range: `bytes=${start}-${end}` } : {}) },
        })
        .then(keepOpen);
    try {
      await waitUntilAvailable(entry);
      try {
        stream = (await fetchUpstream()).data;
      } catch (err) {
        // 403 logo após o available_at (relógios levemente diferentes): mesma URL, 1s depois.
        if (err.response?.status !== 403 || Date.now() > entry.availableAt + AVAILABILITY_GRACE_MS) throw err;
        await sleep(1000);
        stream = (await fetchUpstream()).data;
      }
    } catch (err) {
      invalidate();
      // URLs do googlevideo podem expirar ou ser negadas (403): re-resolve uma vez.
      if (retry && [403, 410].includes(err.response?.status)) return streamYouTube(videoId, req, res, false);
      throw toStreamError(err, videoId);
    }
  }

  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Audio-Source', `youtube/${entry.kind === 'ytdl' ? 'ytdl-core' : 'yt-dlp'}`);
  if (size) {
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', end - start + 1);
    if (range) res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }

  return pipeWithErrors(stream, req, res, videoId, invalidate);
}

/* ------------------------------------------------------------------ */
/* Jamendo / Internet Archive (proxy HTTP genérico)                    */
/* ------------------------------------------------------------------ */

async function proxyRemote(url, req, res, sourceLabel) {
  let upstream;
  try {
    upstream = await axios.get(url, {
      responseType: 'stream',
      timeout: 15_000,
      maxRedirects: 5,
      headers: req.headers.range ? { Range: req.headers.range } : {},
      validateStatus: (s) => s === 200 || s === 206 || s === 416,
    });
    keepOpen(upstream);
  } catch (err) {
    throw new HttpError(502, 'STREAM_FAILED', `Falha ao obter o áudio de ${sourceLabel}.`, {
      reason: err.message,
      tryNext: true,
    });
  }

  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
  }
  res.setHeader('X-Audio-Source', sourceLabel);
  return pipeWithErrors(upstream.data, req, res, sourceLabel); // sem a URL: pode conter a chave da API
}

async function streamJamendo(trackId, req, res) {
  if (!/^\d+$/.test(trackId)) throw new HttpError(400, 'INVALID_ID', 'ID Jamendo inválido.');
  const url = await jamendoAudioUrl(trackId).catch(() => null);
  if (!url) throw new HttpError(502, 'STREAM_FAILED', 'Faixa Jamendo indisponível.', { tryNext: true });
  return proxyRemote(url, req, res, 'jamendo');
}

async function streamArchive(identifier, file, req, res) {
  if (!/^[\w.-]+$/.test(identifier) || !file || file.split('/').some((p) => p === '..' || p === '')) {
    throw new HttpError(400, 'INVALID_ID', 'Identificador do Internet Archive inválido.');
  }
  const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${file
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  return proxyRemote(url, req, res, 'archive');
}

/* ------------------------------------------------------------------ */

function pipeWithErrors(stream, req, res, id, onError) {
  return new Promise((resolve) => {
    const cleanup = () => stream.destroy?.();
    req.on('close', cleanup); // cliente fechou/seek: aborta o download upstream

    stream.on('error', (err) => {
      if (!res.headersSent) {
        // Falhou antes de começar (URL expirada/negada): re-resolve na próxima. Queda no meio do
        // download não invalida a URL; o navegador retoma com Range e reaproveita o cache.
        onError?.();
        const e = toStreamError(err, id);
        ['Content-Range', 'Accept-Ranges', 'Content-Length'].forEach((h) => res.removeHeader(h));
        res.status(e.status).json({ error: e.code, message: e.message, ...e.details });
      } else {
        console.warn(`[stream] conexão com a origem caiu no meio (${id}): ${err.message}`);
        res.destroy(err);
      }
      resolve();
    });
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

module.exports = { streamYouTube, streamJamendo, streamArchive, prefetch };
