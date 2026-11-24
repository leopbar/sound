/**
 * yt-dlp (https://github.com/yt-dlp/yt-dlp): resolve a URL do áudio dos vídeos do YouTube. É
 * atualizado com frequência e resolve assinaturas/n-params usando o Node como runtime JS.
 *
 * Dois caminhos:
 *  - processos permanentes (ytdlp_worker.py; YTDLP_WORKERS, padrão 2): ~1,2 s por vídeo;
 *  - linha de comando, um processo por vídeo (~3 s, ~0,9 s só para o Python subir): reserva quando
 *    nenhum processo permanente está livre, quando ele cai ou trava, e com YTDLP_WORKERS=0.
 *
 * Os dois usam a mesma versão: a da imagem ou a instalada pela atualização automática
 * (ytdlpUpdate.js, via PYTHONPATH). Com a CPU disputada, o desafio JS do YouTube (node) pode levar
 * ~10 s, por isso os limites folgados. Cada processo roda no próprio grupo: no tempo esgotado, o
 * node do desafio morre junto (antes ficava gastando CPU e virava zumbi).
 */
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const update = require('./ytdlpUpdate');

const PYTHON = process.env.YTDLP_PYTHON || 'python3';
const WORKER_SCRIPT = path.join(__dirname, 'ytdlp_worker.py');
const workersEnv = parseInt(process.env.YTDLP_WORKERS, 10);
const POOL_SIZE = Number.isFinite(workersEnv) && workersEnv >= 0 ? Math.min(workersEnv, 8) : 2;

const CLI_TIMEOUT_MS = 40_000;
const WORKER_TIMEOUT_MS = 35_000;
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

// YTDLP_PATH: outro executável do yt-dlp; padrão, o módulo do Python (respeita o PYTHONPATH).
const cli = (args) => (process.env.YTDLP_PATH ? [process.env.YTDLP_PATH, args] : [PYTHON, ['-m', 'yt_dlp', ...args]]);

async function run(args) {
  try {
    const { stdout } = await update.exec(...cli(args), { timeout: CLI_TIMEOUT_MS, envVars: update.env() });
    return stdout;
  } catch (err) {
    if (err.timedOut) update.checkSoon('linha de comando sem resposta');
    // A última linha "ERROR: ..." é a mensagem útil.
    throw Object.assign(errorFrom(err.stderr || '', err.message), { code: err.code });
  }
}

async function isAvailable() {
  if (available === undefined) {
    const version = await update.init().catch(() => null);
    available = Boolean(version);
    if (available) console.log(`[ytdlp] yt-dlp ${version} disponível (${POOL_SIZE} processos permanentes)`);
    else console.warn('[ytdlp] yt-dlp não encontrado; stream do YouTube desativado.');
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
let loggedVersion = null;
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
    // Grupo próprio (detached): kill() derruba também o node que o yt-dlp abre para os desafios.
    this.proc = spawn(PYTHON, [WORKER_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], env: update.env(), detached: true });
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
      if (msg.version && msg.version !== loggedVersion) {
        loggedVersion = msg.version;
        console.log(`[ytdlp] processos permanentes com o yt-dlp ${msg.version}`);
      }
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
    try {
      process.kill(-this.proc.pid, 'SIGKILL');
    } catch {
      this.proc.kill('SIGKILL');
    }
    // Travar costuma ser o yt-dlp velho diante de um YouTube novo.
    update.checkSoon(`processo permanente ${reason}`);
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
  if (!(await isAvailable())) return;
  if (POOL_SIZE) spawnWorkers();
  // Versão nova instalada: troca os processos permanentes (a linha de comando já usa a nova).
  update.schedule(() => recycle());
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

/** Falha que não é do vídeo (formato sumiu, desafio, anti-bot...): talvez o yt-dlp esteja velho. */
function suspectOutdated(reason) {
  update.checkSoon(reason);
}

module.exports = { isAvailable, start, recycle, resolveAudio, suspectOutdated };
