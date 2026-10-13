/**
 * Dois tipos de throttle:
 *  - createThrottle(): fila de saída (outbound) que garante um intervalo mínimo
 *    entre chamadas — usado para respeitar o limite de 1 req/s da MusicBrainz.
 *  - rateLimit(): middleware Express de entrada (inbound), janela fixa por IP.
 */

function createThrottle(minIntervalMs = 1000, { maxQueue = 100 } = {}) {
  let last = 0;
  let chain = Promise.resolve();
  let pending = 0;

  return function schedule(task) {
    if (pending >= maxQueue) {
      return Promise.reject(Object.assign(new Error('Throttle queue full'), { code: 'QUEUE_FULL' }));
    }
    pending++;
    const run = chain.then(async () => {
      const wait = Math.max(0, last + minIntervalMs - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    // A próxima tarefa espera apenas o "slot", não a conclusão da anterior.
    chain = run.catch(() => {});
    return run.then(task).finally(() => {
      pending--;
    });
  };
}

function rateLimit({ windowMs = 60_000, max = 60 } = {}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) if (entry.reset <= now) hits.delete(ip);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count));
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: 'RATE_LIMITED', message: 'Muitas requisições. Tente novamente em instantes.' });
    }
    next();
  };
}

module.exports = { createThrottle, rateLimit };
