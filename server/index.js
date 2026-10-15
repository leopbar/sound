const net = require('net');
const express = require('express');
const cors = require('cors');

// Node 20+ usa "Happy Eyeballs": cada tentativa de conexão (IPv4/IPv6) tem 250ms por
// padrão. Com servidores distantes (LRCLIB, Jamendo etc.) e
// containers sem IPv6, a tentativa IPv4 é abortada e a conexão falha com ETIMEDOUT.
net.setDefaultAutoSelectFamilyAttemptTimeout(Number(process.env.NET_FAMILY_TIMEOUT_MS) || 2000);
const { toNodeHandler } = require('better-auth/node');
const config = require('./config');
const { auth, publicAuthConfig } = require('./auth');
const { migrate } = require('./migrate');
const { pool } = require('./db');
const apiRouter = require('./routes/api');
const playlistsRouter = require('./routes/playlists');
const adminRouter = require('./routes/admin');
const ytdlp = require('./services/ytdlp');
const { requireAuth } = require('./middleware/requireAuth');
const { HttpError } = require('./lib/errors');

const app = express();
app.set('trust proxy', 1); // atrás do nginx: req.ip = IP real do cliente
app.disable('x-powered-by');

app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    credentials: true,
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'X-Audio-Source'],
  })
);

// Better Auth lê o corpo cru: precisa vir antes de qualquer express.json().
// Tudo sob {basePath}/api ('' no local, '/sound' na VPS). As streamUrl das faixas continuam
// relativas (/api/stream/...): o frontend acrescenta o subcaminho.
const api = `${config.basePath}/api`;
app.all(`${api}/auth/*`, toNodeHandler(auth));
app.get(`${api}/auth-config`, (req, res) => res.json(publicAuthConfig));
app.use(`${api}/playlists`, requireAuth, playlistsRouter);
app.use(`${api}/admin`, requireAuth, adminRouter);
app.use(api, apiRouter);
// Healthcheck do Docker (Dockerfile) num caminho fixo, qualquer que seja o subcaminho.
if (config.basePath) app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return res.destroy(err);
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...err.details });
  }
  const upstream = err.response?.status;
  console.error('[error]', err.message);
  if (err.code === 'QUEUE_FULL' || upstream === 503) {
    return res.status(503).json({ error: 'BUSY', message: 'Serviço de metadados ocupado. Tente novamente.' });
  }
  if (err.isAxiosError && !err.response) {
    return res.status(504).json({ error: 'UPSTREAM_UNREACHABLE', message: 'Não foi possível conectar ao serviço externo. Tente novamente.' });
  }
  if (err.isAxiosError) {
    return res.status(502).json({ error: 'UPSTREAM_ERROR', message: 'Falha ao consultar serviço externo.' });
  }
  res.status(500).json({ error: 'INTERNAL', message: 'Erro interno.' });
});

migrate()
  .then(() => {
    const server = app.listen(config.port, () => {
      console.log(`[server] ouvindo em :${config.port} (app: ${config.appUrl})`);
      if (!config.youtubeApiKey) console.log('[server] YOUTUBE_API_KEY ausente: usando busca interna do YouTube.');
      if (!config.jamendoClientId) console.log('[server] JAMENDO_CLIENT_ID ausente: fallback Jamendo desativado.');
      if (!publicAuthConfig.emailVerification) console.log('[server] SMTP_URL ausente: links de e-mail vão para este log e a verificação de e-mail fica desativada.');
      // Processos permanentes do yt-dlp prontos antes do primeiro play.
      ytdlp.start().catch((err) => console.warn('[ytdlp] processos permanentes não subiram:', err.message));
    });
    for (const sig of ['SIGTERM', 'SIGINT']) {
      process.on(sig, () => server.close(() => pool.end().finally(() => process.exit(0))));
    }
  })
  .catch((err) => {
    console.error('[db] falha ao preparar o banco:', err.message);
    process.exit(1);
  });
