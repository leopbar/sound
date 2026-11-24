/**
 * Atualização automática do yt-dlp, sem reconstruir a imagem.
 *
 * O YouTube muda o player com frequência e o yt-dlp da imagem para de funcionar (em nov/2026 o
 * deploy reaproveitava a camada em cache e a versão ficou parada semanas). Aqui o servidor confere
 * o PyPI de tempos em tempos (e logo depois de falhas): havendo versão nova, instala numa pasta
 * gravável (volume `ytdlp`), testa resolvendo um vídeo e passa a usá-la nos processos permanentes e
 * na linha de comando (PYTHONPATH), sem derrubar o servidor.
 *
 *   YTDLP_AUTO_UPDATE=0      desliga
 *   YTDLP_UPDATE_DIR         pasta das versões instaladas (padrão /data/ytdlp)
 *   YTDLP_UPDATE_HOURS       intervalo entre as conferências (padrão 6)
 *   YTDLP_TEST_VIDEO         vídeo usado no teste da versão nova (padrão jNQXAC9IVRw)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PYTHON = process.env.YTDLP_PYTHON || 'python3';
const DIR = process.env.YTDLP_UPDATE_DIR || '/data/ytdlp';
const CURRENT_FILE = path.join(DIR, 'current.json');
const ENABLED = process.env.YTDLP_AUTO_UPDATE !== '0';
const hoursEnv = Number(process.env.YTDLP_UPDATE_HOURS);
const INTERVAL_MS = (hoursEnv > 0 ? hoursEnv : 6) * 3600_000;
const FIRST_CHECK_MS = 2 * 60_000;
const SOON_MIN_GAP_MS = 30 * 60_000; // conferência extra após falha: no máximo a cada 30 min
const TEST_VIDEO = process.env.YTDLP_TEST_VIDEO || 'jNQXAC9IVRw';
const PYPI_URL = 'https://pypi.org/pypi/yt-dlp/json';
const PIP_TIMEOUT_MS = 10 * 60_000;
const TEST_TIMEOUT_MS = 90_000;

let imageVersion = null; // versão instalada na imagem (sem PYTHONPATH)
let canWrite = false; // pasta das versões gravável (senão, nada de atualização)
let active = { version: null, dir: null }; // dir null = a da imagem
let onActivate = () => {};
let running = null; // conferência em andamento (uma por vez)
let lastCheck = 0;
let timer = null;

/** "2026.11.23" > "2026.10.26"; também "2026.11.23.1". */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Ambiente dos processos do yt-dlp: com a versão ativa na frente da instalada na imagem. */
function env() {
  if (!active.dir) return process.env;
  return { ...process.env, PYTHONPATH: active.dir };
}

function activeVersion() {
  return active.version;
}

/**
 * Executa um comando com tempo limite. Grupo de processos próprio (`detached`): no tempo
 * esgotado, mata também os filhos (o yt-dlp abre o node para os desafios do YouTube).
 */
function exec(cmd, args, { timeout, envVars = process.env, maxBuffer = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: envVars, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = null;
    const kill = (reason) => {
      if (killed) return;
      killed = reason;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const t = timeout ? setTimeout(() => kill(`tempo esgotado (${Math.round(timeout / 1000)} s)`), timeout) : null;
    child.stdout.on('data', (d) => {
      stdout += d;
      if (stdout.length > maxBuffer) kill('saída grande demais');
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-20_000);
    });
    child.on('error', (err) => {
      clearTimeout(t);
      reject(Object.assign(err, { stderr }));
    });
    child.on('close', (code, signal) => {
      clearTimeout(t);
      if (code === 0 && !killed) return resolve({ stdout, stderr });
      const err = new Error(killed || `${cmd} terminou com ${signal || `código ${code}`}`);
      reject(Object.assign(err, { stderr, timedOut: Boolean(killed) }));
    });
  });
}

/** Versão do yt-dlp num diretório (null = a da imagem); null se não carregar. */
async function versionIn(dir) {
  const envVars = dir ? { ...process.env, PYTHONPATH: dir } : process.env;
  try {
    const { stdout } = await exec(PYTHON, ['-m', 'yt_dlp', '--version'], { timeout: 30_000, envVars });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function readCurrent() {
  try {
    const data = JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf8'));
    return data?.version && data?.dir ? data : null;
  } catch {
    return null;
  }
}

/** Apaga as versões instaladas que não são a ativa (e sobras de instalações interrompidas). */
function cleanup() {
  let entries = [];
  try {
    entries = fs.readdirSync(DIR, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(DIR, e.name);
    if (full === active.dir) continue;
    fs.rm(full, { recursive: true, force: true }, () => {});
  }
}

function writable() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.accessSync(DIR, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Na subida, antes dos processos permanentes: usa a versão instalada antes, se for mais nova que a
 * da imagem e carregar de verdade; senão, a da imagem (um volume estragado não derruba o player).
 */
async function init() {
  imageVersion = await versionIn(null);
  active = { version: imageVersion, dir: null };
  const saved = readCurrent();
  if (saved && imageVersion && compareVersions(saved.version, imageVersion) > 0) {
    const real = await versionIn(saved.dir);
    if (real && compareVersions(real, imageVersion) > 0) {
      active = { version: real, dir: saved.dir };
    } else {
      console.warn(`[ytdlp] versão ${saved.version} instalada antes não carregou; usando a da imagem.`);
    }
  }
  canWrite = ENABLED && Boolean(imageVersion) && writable();
  if (canWrite) cleanup();
  return active.version;
}

async function latestVersion() {
  const res = await fetch(PYPI_URL, {
    // UA genérico: não mande o UA do app (leva contato).
    headers: { 'User-Agent': 'yt-dlp-update-check', Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`PyPI respondeu ${res.status}`);
  const data = await res.json();
  return data?.info?.version || null;
}

/** Resolve o vídeo de teste com a versão do diretório; true se achou URL de áudio. */
async function works(dir) {
  const args = ['-m', 'yt_dlp', '--no-playlist', '--no-warnings', '--js-runtimes', 'node', '-f', 'bestaudio', '-g'];
  if (process.env.YTDLP_COOKIES_FILE) args.push('--cookies', process.env.YTDLP_COOKIES_FILE);
  args.push(`https://www.youtube.com/watch?v=${TEST_VIDEO}`);
  const envVars = dir ? { ...process.env, PYTHONPATH: dir } : process.env;
  try {
    const { stdout } = await exec(PYTHON, args, { timeout: TEST_TIMEOUT_MS, envVars });
    return /^https?:\/\//m.test(stdout);
  } catch (err) {
    const line = String(err.stderr || err.message).split('\n').reverse().find((l) => l.startsWith('ERROR'));
    console.warn(`[ytdlp] teste ${dir ? 'da versão nova' : 'da versão atual'} falhou: ${(line || err.message).slice(0, 200)}`);
    return false;
  }
}

async function install(version) {
  const target = path.join(DIR, version);
  const tmp = path.join(DIR, `.tmp-${version}-${Date.now()}`);
  try {
    // nice: a instalação não pode disputar CPU com quem está ouvindo música.
    await exec('nice', ['-n', '15', PYTHON, '-m', 'pip', 'install', '--quiet', '--no-cache-dir',
      '--disable-pip-version-check', '--break-system-packages', '--target', tmp, `yt-dlp[default]==${version}`],
    { timeout: PIP_TIMEOUT_MS });
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
    return target;
  } catch (err) {
    fs.rm(tmp, { recursive: true, force: true }, () => {});
    throw new Error(`pip falhou: ${String(err.stderr || err.message).trim().split('\n').pop().slice(0, 200)}`);
  }
}

async function runCheck(reason) {
  lastCheck = Date.now();
  const latest = await latestVersion();
  if (!latest || compareVersions(latest, active.version) <= 0) return false;

  console.log(`[ytdlp] versão nova ${latest} disponível (em uso: ${active.version}; ${reason}); instalando.`);
  const dir = await install(latest);
  const installed = await versionIn(dir);
  if (!installed || compareVersions(installed, active.version) <= 0) {
    throw new Error(`a instalação de ${latest} não carregou (${installed || 'sem versão'})`);
  }
  // Ativa se a nova resolve o vídeo de teste. Se ela falhar, só ativa se a atual também falhar
  // (cookies vencidos, YouTube fora do ar...): nesse caso a mais nova é a melhor aposta.
  if (!(await works(dir)) && (await works(null))) {
    fs.rm(dir, { recursive: true, force: true }, () => {});
    throw new Error(`a versão ${installed} falhou no teste e a atual funciona; mantida a ${active.version}`);
  }
  const previous = active.version;
  active = { version: installed, dir };
  fs.writeFileSync(CURRENT_FILE, JSON.stringify({ version: installed, dir, at: new Date().toISOString() }));
  console.log(`[ytdlp] atualizado de ${previous} para ${installed}; reiniciando os processos permanentes.`);
  onActivate(installed);
  cleanup();
  return true;
}

/** Confere (uma por vez). `reason` vai para o log. */
function check(reason = 'periódica') {
  if (!canWrite) return Promise.resolve(false);
  if (!running) {
    running = runCheck(reason)
      .catch((err) => {
        console.warn(`[ytdlp] atualização automática: ${err.message}`);
        return false;
      })
      .finally(() => {
        running = null;
      });
  }
  return running;
}

/** Depois de uma falha que pode ser do yt-dlp desatualizado: confere já (no máximo a cada 30 min). */
function checkSoon(reason) {
  if (Date.now() - lastCheck < SOON_MIN_GAP_MS) return;
  check(reason);
}

/** Agenda as conferências periódicas. `activate(version)`: chamado ao trocar de versão. */
function schedule(activate) {
  onActivate = activate || onActivate;
  if (!ENABLED || !imageVersion || timer) return;
  if (!canWrite) {
    console.warn(`[ytdlp] ${DIR} não é gravável; atualização automática desativada.`);
    return;
  }
  const tick = () => check().finally(() => {
    timer = setTimeout(tick, INTERVAL_MS);
    timer.unref();
  });
  timer = setTimeout(tick, FIRST_CHECK_MS);
  timer.unref();
}

module.exports = { init, schedule, check, checkSoon, env, exec, activeVersion, compareVersions };
