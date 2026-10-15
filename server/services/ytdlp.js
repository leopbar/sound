/**
 * yt-dlp (https://github.com/yt-dlp/yt-dlp): resolve a URL do áudio dos vídeos do YouTube. É
 * atualizado com frequência e resolve assinaturas/n-params usando o Node como runtime JS.
 *
 * Dois caminhos:
 *  - processos permanentes (ytdlp_worker.py; YTDLP_WORKERS, padrão 2): ~1,2 s por vídeo;
 *  - linha de comando, um processo por vídeo (~3 s, ~0,9 s só para o Python subir): reserva quando
 *    nenhum processo permanente está livre, quando ele cai ou trava, e com YTDLP_WORKERS=0.
 */
const path = require('path');
const readline = require('readline');
const { execFile, spawn } = require('child_process');

const BIN = process.env.YTDLP_PATH || 'yt-dlp';
const PYTHON = process.env.YTDLP_PYTHON || 'python3';
const WORKER_SCRIPT = path.join(__dirname, 'ytdlp_worker.py');
const workersEnv = parseInt(process.env.YTDLP_WORKERS, 10);
const POOL_SIZE = Number.isFinite(workersEnv) && workersEnv >= 0 ? Math.min(workersEnv, 8) : 2;

const CLI_TIMEOUT_MS = 30_000;
const WORKER_TIMEOUT_MS = 20_000;
const WORKER_MAX_JOBS = 300; // recicla de tempos em tempos (a memória do yt-dlp cresce com o uso)
const RESPAWN_MS = [1000, 5000, 30_000, 120_000]; // depois de quedas seguidas
const FORMAT = 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio';

const watchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

/** "ERROR: [youtube] id: Private video" → "Private video" (privado, removido, região...). */
function errorFrom(text, fallback) {
  const line = String(text).split('\n').reverse().find((l) => l.startsWith('ERROR')) || fallback;
  return new Error(line.replace(/^ERROR:\s*(\[[^\]]+\]\s*\S+:\s*)?/, ''));
}

/** Prefere formatos que o navegador toca nativamente (webm/opus, m4a/aac). */
function toSource(fmt) {
  if (!fmt?.url) throw new Error('No playable audio format');
  const clen = Number(new URL(fmt.url).searchParams.get('clen')) || 0;
  const ext = fmt.ext || 'webm';
  return {
    url: fmt.url,
    headers: fmt.http_headers || {},
    mime: ext === 'm4a' ? 'audio/mp4' : `audio/${ext}`,
    size: Number(fmt.filesize) || clen,
    // O YouTube emite URLs que só passam a valer alguns segundos depois (antes disso: 403).
    // O yt-dlp informa o instante em `available_at` (epoch em segundos).
    availableAt: Number(fmt.available_at) * 1000 || 0,
  };
}

/* ------------------------------------------------------------------ */
/* Linha de comando                                                    */
/* ------------------------------------------------------------------ */

let available;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(BIN, args, { timeout: CLI_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      // A última linha "ERROR: ..." é a mensagem útil.
      if (err) return reject(Object.assign(errorFrom(stderr, err.message), { code: err.code }));
      resolve(stdout);
    });
  });
}

async function isAvailable() {
  if (available === undefined) {
    available = await run(['--version']).then(
      (v) => (console.log(`[ytdlp] yt-dlp ${v.trim()} disponível (${POOL_SIZE} processos permanentes)`), true),
      () => (console.warn('[ytdlp] yt-dlp não encontrado; stream do YouTube desativado.'), false)
    );
  }
  return available;
}

async function resolveWithCli(videoId) {
  const args = ['--no-playlist', '--no-warnings', '--js-runtimes', 'node', '-f', FORMAT, '-j', watchUrl(videoId)];
  if (process.env.YTDLP_COOKIES_FILE) args.unshift('--cookies', process.env.YTDLP_COOKIES_FILE);
  const info = JSON.parse(await run(args));
  const fmt = info.requested_downloads?.[0] || info;
  return { ...fmt, available_at: fmt.available_at || info.available_at };
}

/* ------------------------------------------------------------------ */
/* Processos permanentes                                               */
/* ------------------------------------------------------------------ */

/** O processo caiu ou travou (não é erro do vídeo): vale a linha de comando. */
class WorkerUnavailable extends Error {}

const workers = new Set();
let jobSeq = 0;
let crashesInRow = 0;
let respawnTimer = null;

class Worker {
  constructor() {
    this.ready = false;
    this.dead = false;
    this.retiring = false;
    this.job = null; // { id, resolve, reject, timer }
    this.jobs = 0;
    this.killReason = null;
    this.lastStderr = '';
    this.proc = spawn(PYTHON, [WORKER_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdin.on('error', () => {}); // EPIPE se o processo morreu: tratado no 'close'
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => this.onLine(line));
    readline.createInterface({ input: this.proc.stderr }).on('line', (line) => {
      if (line.trim()) this.lastStderr = line.slice(0, 200);
    });
    this.proc.on('error', (err) => this.onExit(err.message)); // não subiu (ex.: sem python3)
    this.proc.on('close', (code, signal) => this.onExit(signal || `código ${code}`));
  }

  get idle() {
    return this.ready && !this.dead && !this.retiring && !this.job;
  }

  resolve(url) {
    return new Promise((resolve, reject) => {
      const id = ++jobSeq;
      const timer = setTimeout(() => this.kill(`sem resposta em ${WORKER_TIMEOUT_MS / 1000} s`), WORKER_TIMEOUT_MS);
      this.job = { id, resolve, reject, timer };
      this.proc.stdin.write(`${JSON.stringify({ id, url })}\n`);
    });
  }

  onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.ready) {
      this.ready = true;
      return;
    }
    const { job } = this;
    if (!job || msg.id !== job.id) return;
    clearTimeout(job.timer);
    this.job = null;
    crashesInRow = 0;
    if (this.retiring || ++this.jobs >= WORKER_MAX_JOBS) this.retire();
    if (msg.ok) job.resolve(msg.format);
    else job.reject(errorFrom(msg.error, msg.error || 'yt-dlp falhou'));
  }

  /** Encerra quando terminar o pedido em andamento; outro sobe no lugar. */
  retire() {
    this.retiring = true;
    if (!this.job) this.proc.stdin.end();
  }

  kill(reason) {
    this.killReason = reason;
    this.proc.kill('SIGKILL');
  }

  onExit(reason) {
    if (this.dead) return;
    this.dead = true;
    workers.delete(this);
    if (this.job) {
      clearTimeout(this.job.timer);
      this.job.reject(new WorkerUnavailable(this.killReason || reason));
      this.job = null;
    }
    if (this.retiring && !this.killReason) {
      spawnWorkers();
      return;
    }
    const detail = this.lastStderr ? `: ${this.lastStderr}` : '';
    console.warn(`[ytdlp] processo permanente encerrou (${this.killReason || reason})${detail}; linha de comando até ele voltar.`);
    scheduleRespawn();
  }
}

function spawnWorkers() {
  while (workers.size < POOL_SIZE) workers.add(new Worker());
}

function scheduleRespawn() {
  if (respawnTimer) return;
  const delay = RESPAWN_MS[Math.min(crashesInRow, RESPAWN_MS.length - 1)];
  crashesInRow++;
  respawnTimer = setTimeout(() => {
    respawnTimer = null;
    spawnWorkers();
  }, delay);
  respawnTimer.unref();
}

/** Na subida do servidor: deixa os processos permanentes prontos antes do primeiro play. */
async function start() {
  if (POOL_SIZE && (await isAvailable())) spawnWorkers();
}

/** O processo permanente errou onde a linha de comando acertou: troca todos (estado velho). */
function recycle() {
  for (const w of workers) w.retire();
}

/**
 * Resolve a melhor faixa somente-áudio: { url, headers, mime, size, availableAt, via }.
 * `via`: 'worker' (processo permanente) ou 'cli' (linha de comando), também nos erros.
 * `priority: 'low'` (pré-carga) deixa um processo livre para quem clicou; `cli` força a reserva.
 */
async function resolveAudio(videoId, { priority = 'high', cli = false } = {}) {
  const idle = cli ? [] : [...workers].filter((w) => w.idle);
  const worker = priority === 'low' && POOL_SIZE > 1 ? idle.length > 1 && idle[0] : idle[0];
  if (worker) {
    try {
      return { ...toSource(await worker.resolve(watchUrl(videoId))), via: 'worker' };
    } catch (err) {
      if (!(err instanceof WorkerUnavailable)) throw Object.assign(err, { via: 'worker' });
      // Caiu ou travou no meio: segue para a linha de comando.
    }
  }
  try {
    return { ...toSource(await resolveWithCli(videoId)), via: 'cli' };
  } catch (err) {
    throw Object.assign(err, { via: 'cli' });
  }
}

module.exports = { isAvailable, start, recycle, resolveAudio };
