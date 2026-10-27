/** Tradução das letras pelo LibreTranslate na rede interna do Docker. */
const crypto = require('crypto');
const axios = require('axios');
const { pool } = require('../db');
const { remember } = require('../lib/cache');
const { HttpError } = require('../lib/errors');

const TARGET = process.env.LIBRETRANSLATE_TARGET || 'pt-BR';
const TTL = 60 * 60 * 24 * 7;
const http = axios.create({
  baseURL: process.env.LIBRETRANSLATE_URL || 'http://libretranslate:5000',
  timeout: 60000,
});
const unavailable = () => new HttpError(502, 'TRANSLATION_UNAVAILABLE', 'Tradução indisponível no momento.');
const isPortuguese = (lang) => /^(pt(?:[-_]br)?|pb)$/i.test(lang || '');

async function post(path, body) {
  try {
    const { data } = await http.post(path, {
      ...body,
      ...(process.env.LIBRETRANSLATE_API_KEY ? { api_key: process.env.LIBRETRANSLATE_API_KEY } : {}),
    });
    return data;
  } catch (err) {
    console.warn('[translate] LibreTranslate falhou:', err.response?.status || err.code || err.message);
    throw unavailable();
  }
}

// Limita o trabalho por chamada, preservando uma tradução por linha.
function chunks(lines) {
  const parts = [];
  let part = [];
  let size = 0;
  for (const line of lines) {
    if (part.length && (size + line.length > 4000 || part.length >= 50)) {
      parts.push(part);
      part = [];
      size = 0;
    }
    part.push(line);
    size += line.length;
  }
  if (part.length) parts.push(part);
  return parts;
}

async function translateLines(lines) {
  const unique = [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
  if (!unique.length) return { lang: null, same: false, translations: lines.map(() => '') };
  const key = `libretranslate:v1:${TARGET}:${crypto.createHash('sha256').update(JSON.stringify(unique)).digest('hex')}`;
  const result = await remember(key, TTL, async () => {
    try {
      const { rows } = await pool.query('SELECT data FROM translation_cache WHERE key = $1', [key]);
      if (rows[0]) return rows[0].data;
    } catch (err) {
      console.warn('[translate] leitura do cache falhou:', err.message);
    }
    // Detecta pela letra inteira: frases curtas isoladas confundem o detector.
    const detected = await post('/detect', { q: unique.join('\n').slice(0, 4000) });
    const lang = Array.isArray(detected) ? detected[0]?.language : null;
    if (typeof lang !== 'string' || !lang) throw unavailable();
    const map = Object.create(null);
    const same = isPortuguese(lang);
    if (!same) {
      for (const part of chunks(unique)) {
        const data = await post('/translate', { q: part, source: lang, target: TARGET, format: 'text' });
        const out = data?.translatedText;
        if (!Array.isArray(out) || out.length !== part.length || out.some((s) => typeof s !== 'string' || !s.trim())) {
          throw unavailable();
        }
        part.forEach((line, i) => { map[line] = out[i].trim(); });
      }
    }
    const translated = { lang, same, map };
    try {
      await pool.query('INSERT INTO translation_cache (key, data) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, translated]);
    } catch (err) {
      console.warn('[translate] gravação do cache falhou:', err.message);
    }
    return translated;
  });
  return {
    lang: result.lang,
    same: result.same,
    translations: result.same ? [] : lines.map((line) => {
      const text = result.map[line.trim()] || '';
      return text.toLowerCase() === line.trim().toLowerCase() ? '' : text;
    }),
  };
}
module.exports = { translateLines };
