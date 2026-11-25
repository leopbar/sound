/**
 * yt-dlp (https://github.com/yt-dlp/yt-dlp): resolve a URL do áudio dos vídeos do YouTube. É
 * atualizado com frequência e resolve assinaturas/n-params usando o Node como runtime JS.
 *
 * Dois caminhos:
 *  - processos permanentes (ytdlp_worker.py; YTDLP_WORKERS, padrão 2): um vídeo por vez cada, com
 *    o player do YouTube já analisado em cache (é o que deixa o desafio JS barato);
 *  - linha de comando, um processo por vídeo, igual à do yt-dlp e bem mais lenta (analisa o
 *    player inteiro a cada vídeo): reserva quando não há processo permanente, quando ele cai,
 *    trava ou erra, e com YTDLP_WORKERS=0.
 *
 * Os pedidos aos processos permanentes passam por uma fila: clique na frente, pré-carga atrás
 * (e a pré-carga sempre deixa um processo livre para o clique). A pré-carga nunca vai para a linha
 * de comando: várias delas ao mesmo tempo disputavam a CPU com a música que a pessoa clicou.
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
// Clique sem processo livre: espera um vagar (um vídeo leva poucos segundos) antes de apelar para
// a linha de comando, que num servidor lento demora bem mais do que essa espera.
const QUEUE_WAIT_MS = 20_000;
const LOW_MAX_AGE_MS = 60_000; // pré-carga parada na fila há esse tempo já não interessa
const LOW_QUEUE_MAX = 8; // pré-cargas na fila; passando disso, saem as mais antigas
const RESPAWN_MS =[1000, 5000, 30_000, 120_000]; // depois de quedas seguidas
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

  /** `fresh`: apaga os players do YouTube em cache antes de resolver (ver ytdlp_worker.py). */
  resolve(url, fresh = false) {
    return new Promise((resolve, reject) => {
      const id = ++jobSeq;
      const timer = setTimeout(() => this.kill(`sem resposta em ${WORKER_TIMEOUT_MS / 1000} s`), WORKER_TIMEOUT_MS);
      this.job = { id, resolve, reject, timer };
      this.proc.stdin.write(`${JSON.stringify({ id, url, fresh })}\n`);
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
        const cache = msg.playerCache ? 'com' : 'SEM';
        console.log(`[ytdlp] processos permanentes com o yt-dlp ${msg.version} (${cache} cache do player analisado)`);
      }
      pump();
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
    pump();
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
  warmUp();
  // Versão nova instalada: troca os processos permanentes (a linha de comando já usa a nova).
  update.schedule(onNewVersion);
}

/**
 * Troca todos os processos permanentes. `purge`: o processo errou onde a linha de comando acertou;
 * o próximo vídeo apaga também os players em cache (podem ser a causa).
 */
function recycle({ purge = false } = {}) {
  if (purge) purgePlayers();
  for (const w of workers) w.retire();
}

/** O próximo vídeo apaga os players do YouTube em cache antes de resolver (suspeita de cache ruim). */
function purgePlayers() {
  purgeNext = true;
}

/** Versão nova do yt-dlp: processos novos e o player já analisado antes do próximo clique. */
function onNewVersion() {
  recycle();
  warmUp();
}

/**
 * Resolve um vídeo qualquer para o player do YouTube ficar analisado em cache: sem isso, a primeira
 * música depois de subir (ou de trocar de versão) pagaria a análise inteira.
 */
function warmUp() {
  if (!POOL_SIZE) return;
  const t0 = Date.now();
  resolveAudio(update.TEST_VIDEO, { priority: 'low' }).then(
    () => console.log(`[ytdlp] aquecimento: player do YouTube pronto em ${((Date.now() - t0) / 1000).toFixed(1)} s`),
    (err) => console.warn(`[ytdlp] aquecimento falhou: ${err.message}`)
  );
}

/* ------------------------------------------------------------------ */
/* Fila dos processos permanentes                                      */
/* ------------------------------------------------------------------ */

const queue = []; // esperando um processo: { videoId, priority, fresh, since, timer, resolve, reject }
const pending = new Map(); // videoId → pedido (na fila ou em andamento), para o clique passar à frente
let purgeNext = false;

function unqueue(job) {
  const i = queue.indexOf(job);
  if (i >= 0) queue.splice(i, 1);
  clearTimeout(job.timer);
}

/** Tira o pedido da fila sem resolver: o clique segue para a linha de comando; a pré-carga, não. */
function giveUp(job, reason) {
  unqueue(job);
  job.reject(new WorkerUnavailable(reason));
}

function armTimer(job) {
  clearTimeout(job.timer);
  const ms = job.priority === 'high' ? QUEUE_WAIT_MS : LOW_MAX_AGE_MS;
  job.timer = setTimeout(() => giveUp(job, `sem processo livre em ${ms / 1000} s`), ms);
  job.timer.unref();
}

/** Entrega os pedidos da fila aos processos livres: cliques primeiro. */
function pump() {
  while (queue.length) {
    const idle = [...workers].filter((w) => w.idle);
    if (!idle.length) return;
    let i = queue.findIndex((j) => j.priority === 'high');
    if (i < 0) {
      // Só pré-cargas na fila: sempre fica um processo livre para quem clicar.
      if (POOL_SIZE > 1 && idle.length < 2) return;
      i = 0;
    }
    const job = queue[i];
    unqueue(job);
    const fresh = job.fresh || purgeNext;
    purgeNext = false;
    const queuedMs = Date.now() - job.since;
    idle[0].resolve(watchUrl(job.videoId), fresh).then((format) => job.resolve({ format, queuedMs }), job.reject);
  }
}

/** Resolve num processo permanente; rejeita com WorkerUnavailable se não houver como. */
function viaWorker(videoId, priority, fresh) {
  const job = { videoId, priority, fresh, since: Date.now(), timer: null };
  const promise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });
  pending.set(videoId, job);
  if (priority === 'high' && !workers.size) {
    // Nenhum processo de pé (caiu e ainda não voltou): o clique não espera.
    job.reject(new WorkerUnavailable('nenhum processo permanente'));
  } else {
    queue.push(job);
    armTimer(job);
    const low = queue.filter((j) => j.priority === 'low');
    for (const old of low.slice(0, Math.max(0, low.length - LOW_QUEUE_MAX))) giveUp(old, 'pré-cargas demais na fila');
    pump();
  }
  return promise
    .finally(() => {
      if (pending.get(videoId) === job) pending.delete(videoId);
    })
    .catch((err) => {
      // A prioridade no momento da falha: a pré-carga pode ter virado clique no caminho.
      throw Object.assign(err, { low: job.priority === 'low' });
    });
}

/** Alguém clicou numa faixa que estava em pré-carga: ela passa para a frente da fila. */
function prioritize(videoId) {
  const job = pending.get(videoId);
  if (!job || job.priority === 'high') return;
  job.priority = 'high';
  if (queue.includes(job)) {
    armTimer(job);
    pump();
  }
}

/**
 * Resolve a melhor faixa somente-áudio: { url, headers, mime, size, availableAt, via, queuedMs }.
 * `via`: 'worker' (processo permanente) ou 'cli' (linha de comando), também nos erros.
 * `priority: 'low'` (pré-carga): espera a vez na fila e nunca usa a linha de comando (o erro leva
 * `low: true`, e `unavailable: true` se nem chegou a ser resolvida). `cli` força a linha de
 * comando. `fresh`: apaga antes os players em cache.
 */
async function resolveAudio(videoId, { priority = 'high', cli = false, fresh = false } = {}) {
  if (!cli && POOL_SIZE) {
    try {
      const { format, queuedMs } = await viaWorker(videoId, priority, fresh);
      return { ...toSource(format), via: 'worker', queuedMs };
    } catch (err) {
      // Erro do vídeo ou do yt-dlp, ou pré-carga que ficou sem processo (`unavailable`): quem
      // chamou decide.
      const unavailable = err instanceof WorkerUnavailable;
      if (!unavailable || err.low) throw Object.assign(err, { via: 'worker', unavailable });
      // Clique, e o processo caiu, travou ou não vagou a tempo: segue para a linha de comando.
    }
  }
  try {
    return { ...toSource(await resolveWithCli(videoId)), via: 'cli', queuedMs: 0 };
  } catch (err) {
    throw Object.assign(err, { via: 'cli' });
  }
}

/** Falha que não é do vídeo (formato sumiu, desafio, anti-bot...): talvez o yt-dlp esteja velho. */
function suspectOutdated(reason) {
  update.checkSoon(reason);
}

module.exports = { isAvailable, start, recycle, purgePlayers, resolveAudio, prioritize, suspectOutdated };
