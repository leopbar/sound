// Gera os ícones do PWA em public/icons/ a partir de um único desenho SVG.
// Uso (sharp não fica no package.json; só é preciso ao mudar o ícone):
//   npm i --no-save sharp && node scripts/gen-icons.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = new URL('../public/icons/', import.meta.url);

// "S" de Sound cuja ponta inferior vira a cabeça de uma nota musical, entre barras de equalizador.
const art = `
  <g stroke-linecap="round" stroke-width="14">
    <path d="M96 240v32" stroke="#1ea7ff" stroke-opacity=".35"/>
    <path d="M128 214v84" stroke="#1ea7ff" stroke-opacity=".6"/>
    <path d="M384 196v84" stroke="#3b6cff" stroke-opacity=".6"/>
    <path d="M416 222v32" stroke="#3b6cff" stroke-opacity=".35"/>
  </g>
  <path d="M330 172C304 128 190 128 190 200c0 64 136 48 136 116 0 60-90 76-130 40"
        fill="none" stroke="url(#ink)" stroke-width="42" stroke-linecap="round"/>
  <ellipse cx="176" cy="360" rx="44" ry="32" transform="rotate(-24 176 360)" fill="#3b6cff"/>`;

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1c1c26"/><stop offset="1" stop-color="#08080b"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="#1ea7ff" stop-opacity=".28"/><stop offset="1" stop-color="#1ea7ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7cd0ff"/><stop offset=".5" stop-color="#1ea7ff"/><stop offset="1" stop-color="#3b6cff"/>
    </linearGradient>
  </defs>`;

// radius: cantos arredondados (0 = quadrado cheio). scale: encolhe o desenho (zona segura do maskable).
const svg = ({ radius = 112, scale = 1 } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="230" fill="url(#glow)"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${art}</g>
</svg>`;

const png = (source, size, name) => sharp(Buffer.from(source)).resize(size, size).png().toFile(fileURLToPath(new URL(name, OUT)));

await writeFile(new URL('icon.svg', OUT), svg());
await Promise.all([
  png(svg(), 192, 'icon-192.png'),
  png(svg(), 512, 'icon-512.png'),
  // Android recorta o maskable em círculo/squircle: fundo cheio e desenho dentro dos 80% centrais.
  png(svg({ radius: 0, scale: 0.82 }), 512, 'icon-maskable-512.png'),
  // iOS aplica os cantos sozinho e não aceita transparência.
  png(svg({ radius: 0, scale: 0.9 }), 180, 'apple-touch-icon.png'),
]);
console.log('Ícones gerados em public/icons/');
