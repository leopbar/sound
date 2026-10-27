const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { pool } = require('../db');
const { cache } = require('../lib/cache');

function setup(t, handler, stored = new Map()) {
  cache.flushAll();
  t.mock.method(axios, 'create', () => ({ post: async (path, body) => ({ data: await handler(path, body) }) }));
  t.mock.method(pool, 'query', async (sql, [key, value]) => {
    if (sql.startsWith('SELECT')) return { rows: stored.has(key) ? [{ data: stored.get(key) }] : [] };
    stored.set(key, JSON.parse(JSON.stringify(value)));
    return { rows: [] };
  });
  delete require.cache[require.resolve('../services/translate')];
  return require('../services/translate').translateLines;
}

test('preserves line order, blank lines and repeated choruses; detects once', async (t) => {
  const calls = [];
  const translate = setup(t, (path, body) => {
    calls.push([path, body]);
    if (path === '/detect') return [{ language: 'en', confidence: 95 }];
    assert.deepEqual(body.q, ['Hello', 'World']);
    assert.equal(body.source, 'en');
    assert.equal(body.target, 'pt-BR');
    return { translatedText: ['Olá', 'Mundo'] };
  });
  assert.deepEqual(await translate(['Hello', '', ' World ', 'Hello']), {
    lang: 'en', same: false, translations: ['Olá', '', 'Mundo', 'Olá'],
  });
  assert.equal(calls.length, 2);
  await translate(['Hello', '', ' World ', 'Hello']);
  assert.equal(calls.length, 2);
});

test('Portuguese lyrics do not call translate; empty lyrics do not call detect', async (t) => {
  const translate = setup(t, (path) => {
    assert.equal(path, '/detect');
    return [{ language: 'pt' }];
  });
  assert.deepEqual(await translate(['   ', '']), { lang: null, same: false, translations: ['', ''] });
  assert.deepEqual(await translate(['Já estou em casa']), { lang: 'pt', same: true, translations: [] });
});

test('persistent cache survives memory cache eviction', async (t) => {
  let calls = 0;
  const translate = setup(t, (path) => {
    calls++;
    return path === '/detect' ? [{ language: 'en' }] : { translatedText: ['Bom dia'] };
  });
  await translate(['Good morning']);
  cache.flushAll();
  assert.deepEqual((await translate(['Good morning'])).translations, ['Bom dia']);
  assert.equal(calls, 2);
});

test('malformed or failed translation is never cached and can be retried', async (t) => {
  let attempts = 0;
  const translate = setup(t, (path) => {
    if (path === '/detect') return [{ language: 'en' }];
    if (++attempts === 1) return { translatedText: [] };
    if (attempts === 2) throw Object.assign(new Error('unavailable'), { response: { status: 503 } });
    return { translatedText: ['Olá'] };
  });
  await assert.rejects(translate(['Hello']), { code: 'TRANSLATION_UNAVAILABLE' });
  await assert.rejects(translate(['Hello']), { code: 'TRANSLATION_UNAVAILABLE' });
  assert.deepEqual((await translate(['Hello'])).translations, ['Olá']);
});

test('batch limits retain alignment across 50 items and 4000 characters', async (t) => {
  let batches = 0;
  const translate = setup(t, (path, body) => {
    if (path === '/detect') return [{ language: 'en' }];
    batches++;
    assert.ok(body.q.length <= 50);
    assert.ok(body.q.join('').length <= 4000);
    return { translatedText: body.q.map((s) => `traduzido ${s}`) };
  });
  const lines = Array.from({ length: 110 }, (_, i) => `line ${i} ${'a'.repeat(100)}`);
  assert.deepEqual((await translate(lines)).translations, lines.map((s) => `traduzido ${s}`));
  assert.ok(batches >= 3);
});

test('concurrent requests for the same lyrics share one translation', async (t) => {
  let calls = 0;
  const translate = setup(t, async (path) => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return path === '/detect' ? [{ language: 'en' }] : { translatedText: ['Olá'] };
  });
  const results = await Promise.all([translate(['Hello']), translate(['Hello'])]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(calls, 2);
});
