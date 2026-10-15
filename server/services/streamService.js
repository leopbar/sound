/**
 * Proxy de streaming de áudio.
 *  - YouTube: URL do áudio resolvida pelo yt-dlp (ytdlp.js: processos permanentes, com a linha
 *    de comando de reserva) e repassada com HTTP Range para o <audio> fazer seek.
 *  - Jamendo / Internet Archive: proxy HTTP simples com repasse de Range.
 */
const axios = require('axios');
const NodeCache = require('node-cache');
const { TTL } = require('../lib/cache');
const { HttpError } = require('../lib/errors');
const { jamendoAudioUrl } = require('./fallbacks');
const ytdlp = require('./ytdlp');

// Cache dedicado com limite de entradas.
const infoCache = new NodeCache({ stdTTL: TTL.STREAM_INFO, maxKeys: 300, useClones: false });

const VIDEO_ID = /^[\w-]{11}$/;

/* ------------------------------------------------------------------ */
/* Classificação de erros do yt-dlp                                    */
/* ------------------------------------------------------------------ */

const ERROR_PATTERNS = [
  [/private video|video is private/i, 'VIDEO_PRIVATE', 'O vídeo é privado.'],
  [/not available in your country|blocked it in your country|region/i, 'REGION_BLOCKED', 'O vídeo está bloqueado nesta região.'],
  [/removed|terminated|no longer available|does not exist|video (is )?unavailable/i, 'VIDEO_REMOVED', 'O vídeo foi removido ou está indisponível.'],
  [/confirm your age|age-restricted|inappropriate/i, 'AGE_RESTRICTED', 'O vídeo tem restrição de idade.'],
  [/not a bot|sign in to confirm/i, 'BOT_CHECK', 'O YouTube exigiu verificação anti-bot (configure YTDLP_COOKIES_FILE).'],
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

// Erros definitivos: a linha de comando daria o mesmo resultado do processo permanente.
const FATAL = new Set(['VIDEO_PRIVATE', 'VIDEO_REMOVED', 'REGION_BLOCKED', 'COPYRIGHT_BLOCKED', 'AGE_RESTRICTED']);

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
  for (const id of videoIds) getAudioSource(id, 'low').catch(() => {});
}

/**
 * Resolve a fonte de áudio de um vídeo pelo yt-dlp. O resultado fica em cache (as URLs do
 * googlevideo valem ~6h). `priority: 'low'` = pré-carga (ninguém esperando).
 */
const inflight = new Map();
function getAudioSource(videoId, priority = 'high') {
  const cached = infoCache.get(videoId);
  if (cached) return Promise.resolve(cached);
  // Prefetch e play simultâneos compartilham a mesma resolução.
  if (!inflight.has(videoId)) {
    inflight.set(videoId, resolveSource(videoId, priority).finally(() => inflight.delete(videoId)));
  }
  return inflight.get(videoId);
}

async function resolveSource(videoId, priority) {
  let entry;
  try {
    entry = await ytdlp.resolveAudio(videoId, { priority });
  } catch (err) {
    const classified = toStreamError(err, videoId);
    if (err.via !== 'worker' || FATAL.has(classified.code)) throw classified;
    // Reserva: o processo permanente errou onde a linha de comando pode acertar (estado velho dele).
    try {
      entry = await ytdlp.resolveAudio(videoId, { cli: true });
    } catch (cliErr) {
      throw toStreamError(cliErr, videoId);
    }
    console.warn(`[stream] processo permanente do yt-dlp falhou para ${videoId} (${err.message}) e a linha de comando resolveu; reiniciando-o.`);
    ytdlp.recycle();
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
  if (!VIDEO_ID.test(videoId)) {
    throw new HttpError(400, 'INVALID_VIDEO_ID', 'ID de vídeo inválido.', { videoId });
  }

  // Tempos de cada etapa, para o log (diagnóstico da demora para começar a tocar).
  const t0 = Date.now();
  const src = infoCache.has(videoId) ? 'cache' : inflight.has(videoId) ? 'joined' : null;
  const entry = await getAudioSource(videoId);
  const resolveMs = Date.now() - t0;
  const { size, mime } = entry;
  const range = parseRange(req.headers.range, size);

  if (range === 'unsatisfiable') {
    res.status(416).setHeader('Content-Range', `bytes */${size}`);
    return res.end();
  }

  const { start, end } = range || { start: 0, end: size - 1 };
  const invalidate = () => infoCache.del(videoId); // URL expirada/negada: re-resolve na próxima

  // URL direta do googlevideo: sempre pedimos um intervalo explícito (evita throttling).
  const fetchUpstream = () =>
    axios
      .get(entry.url, {
        responseType: 'stream',
        timeout: 15_000,
        headers: { ...entry.headers, ...(size ? { Range: `bytes=${start}-${end}` } : {}) },
      })
      .then(keepOpen);
  let stream;
  let waitMs;
  let upstreamMs;
  try {
    await waitUntilAvailable(entry);
    waitMs = Date.now() - t0 - resolveMs;
    const t1 = Date.now();
    try {
      stream = (await fetchUpstream()).data;
    } catch (err) {
      // 403 logo após o available_at (relógios levemente diferentes): mesma URL, 1s depois.
      if (err.response?.status !== 403 || Date.now() > entry.availableAt + AVAILABILITY_GRACE_MS) throw err;
      await sleep(1000);
      stream = (await fetchUpstream()).data;
    }
    upstreamMs = Date.now() - t1;
  } catch (err) {
    invalidate();
    // URLs do googlevideo podem expirar ou ser negadas (403): re-resolve uma vez.
    if (retry && [403, 410].includes(err.response?.status)) return streamYouTube(videoId, req, res, false);
    throw toStreamError(err, videoId);
  }

  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Audio-Source', 'youtube/yt-dlp');
  if (size) {
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', end - start + 1);
    if (range) res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }

  console.log(
    `[stream] ${videoId} bytes=${start}-${end} src=${src || entry.via} resolve=${resolveMs}ms ` +
      `wait=${waitMs}ms upstream=${upstreamMs}ms total=${Date.now() - t0}ms${retry ? '' : ' retry=1'}`
  );
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
