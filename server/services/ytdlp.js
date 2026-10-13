/**
 * Extrator de reserva baseado no yt-dlp (https://github.com/yt-dlp/yt-dlp).
 * O ytdl-core quebra sempre que o YouTube muda o player; o yt-dlp é atualizado
 * com frequência e resolve assinaturas/n-params usando o Node como runtime JS.
 */
const { execFile } = require('child_process');

const BIN = process.env.YTDLP_PATH || 'yt-dlp';
const TIMEOUT_MS = 30_000;

let available;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(BIN, args, { timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // A última linha "ERROR: ..." é a mensagem útil (privado, removido, região...).
        const line = String(stderr).split('\n').reverse().find((l) => l.startsWith('ERROR')) || err.message;
        return reject(Object.assign(new Error(line.replace(/^ERROR:\s*(\[[^\]]+\]\s*\S+:\s*)?/, '')), { code: err.code }));
      }
      resolve(stdout);
    });
  });
}

async function isAvailable() {
  if (available === undefined) {
    available = await run(['--version']).then(
      (v) => (console.log(`[ytdlp] yt-dlp ${v.trim()} disponível`), true),
      () => (console.warn('[ytdlp] yt-dlp não encontrado; fallback desativado.'), false)
    );
  }
  return available;
}

/**
 * Resolve a melhor faixa somente-áudio. Retorna { url, headers, mime, size }.
 * Prefere formatos que o navegador toca nativamente (webm/opus, m4a/aac).
 */
async function resolveAudio(videoId) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--js-runtimes', 'node',
    '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
    '-j',
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  if (process.env.YTDLP_COOKIES_FILE) args.unshift('--cookies', process.env.YTDLP_COOKIES_FILE);

  const info = JSON.parse(await run(args));
  const fmt = info.requested_downloads?.[0] || info;
  if (!fmt.url) throw new Error('No playable audio format');

  const clen = Number(new URL(fmt.url).searchParams.get('clen')) || 0;
  const ext = fmt.ext || 'webm';
  return {
    url: fmt.url,
    headers: fmt.http_headers || {},
    mime: ext === 'm4a' ? 'audio/mp4' : `audio/${ext}`,
    size: Number(fmt.filesize) || clen,
    // O YouTube emite URLs que só passam a valer alguns segundos depois (antes disso: 403).
    // O yt-dlp informa o instante em `available_at` (epoch em segundos).
    availableAt: Number(fmt.available_at || info.available_at) * 1000 || 0,
  };
}

module.exports = { isAvailable, resolveAudio };
