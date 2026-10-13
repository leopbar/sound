const net = require('net');
const express = require('express');
const cors = require('cors');

// Node 20+ usa "Happy Eyeballs": cada tentativa de conexão (IPv4/IPv6) tem 250ms por
// padrão. Com servidores distantes (MusicBrainz fica na Alemanha, ~200-330ms daqui) e
// containers sem IPv6, a tentativa IPv4 é abortada e a conexão falha com ETIMEDOUT.
net.setDefaultAutoSelectFamilyAttemptTimeout(Number(process.env.NET_FAMILY_TIMEOUT_MS) || 2000);
const config = require('./config');
const apiRouter = require('./routes/api');
const { HttpError } = require('./lib/errors');

const app = express();
app.set('trust proxy', 1); // atrás do nginx: req.ip = IP real do cliente
app.disable('x-powered-by');

app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')),
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'X-Audio-Source'],
  })
);

app.use('/api', apiRouter);

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

const server = app.listen(config.port, () => {
  console.log(`[server] ouvindo em :${config.port}`);
  if (!config.youtubeApiKey) console.log('[server] YOUTUBE_API_KEY ausente: usando busca interna do YouTube.');
  if (!config.jamendoClientId) console.log('[server] JAMENDO_CLIENT_ID ausente: fallback Jamendo desativado.');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
