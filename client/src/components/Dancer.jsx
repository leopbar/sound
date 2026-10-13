import { useEffect, useRef } from 'react';
import { usePlayerStore, selectCurrentTrack } from '../store/playerStore';
import { useDancerStore } from '../store/dancerStore';
import { engine } from '../lib/audioEngine';
import { BeatTracker } from '../lib/beatTracker';
import { getBeatGrid } from '../lib/beatGrid';
import { DANCERS } from './dancers';

const TAU = Math.PI * 2;
const VARS = ['bob', 'sway', 'hip', 'squash', 'armL', 'armR', 'legL', 'legR', 'head', 'pulse'];
const REST = { bob: 0, sway: 0, hip: 0, squash: 1, armL: 10, armR: 10, legL: 0, legR: 0, head: 0, pulse: 0 };

/**
 * Passos de dança; trocam a cada 2 compassos. `b` = batidas (contínuo), `A` = intensidade 0..1,
 * `hit` = 1 exatamente na batida e cai rápido (marca o tempo), `alt` = muda de lado a cada batida.
 */
const MOVES = [
  // Sobe e desce socando o ar.
  (b, A, hit) => ({ armL: 30 + 75 * A * hit, armR: 30 + 75 * A * hit, legL: 4 * A, legR: 4 * A }),
  // Requebra de lado, um braço de cada vez.
  (b, A, hit, alt) => ({ armL: 25 + 60 * A * Math.max(0, alt), armR: 25 + 60 * A * Math.max(0, -alt), sway: 12 * A * alt, hip: 8 * A * alt }),
  // Mãos para o alto empurrando o teto na batida.
  (b, A, hit) => ({ armL: 120 + 40 * A * hit, armR: 120 + 40 * A * hit }),
  // Um braço acenando lá em cima, o outro marcando o tempo.
  (b, A, hit, alt) => ({ armL: 145 + 25 * A * alt, armR: 20 + 35 * A * hit }),
  // Passinho: pernas alternadas, braços balançando.
  (b, A, hit, alt) => ({
    armL: 30 + 40 * A * Math.max(0, -alt),
    armR: 30 + 40 * A * Math.max(0, alt),
    legL: 22 * A * Math.max(0, alt),
    legR: 22 * A * Math.max(0, -alt),
    sway: 5 * A * alt,
  }),
];

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Posição em batidas (contínua) no tempo `t`, pela grade pré-calculada da faixa. */
function gridPosition(beats, t) {
  const n = beats.length;
  if (t < beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - beats[lo]) / (beats[lo + 1] - beats[lo]);
}

// A suavização da pose (~25 ms) e o quadro só aparecer no próximo refresh atrasam o movimento;
// olhar um pouco à frente compensa (medido: ~35 ms de atraso sem isso).
const VISUAL_LEAD_S = 0.035;

/** Atraso entre o que o elemento <audio> está tocando e o que sai no alto-falante. */
function outputLatency() {
  const ctx = engine.ctx;
  if (!ctx) return 0;
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
}

function targetPose({ b, downbeat, energy, playing, t, beatLen }) {
  if (!playing) {
    // Parado: só "respira".
    return { ...REST, bob: 1.5 * Math.sin(t * 2), head: 2 * Math.sin(t * 1.3) };
  }
  const A = Math.min(1, 0.35 + 0.75 * energy);
  const frac = b - Math.floor(b);
  // Ataque seco na batida e volta suave (~0,15 s): é o que faz o movimento "cair" no tempo.
  const hit = Math.exp(-(frac * beatLen) / 0.15);
  const alt = Math.sin(Math.PI * b);
  const beatInBar = (((Math.floor(b) - downbeat) % 4) + 4) % 4;
  const accent = beatInBar === 0 ? 1 : 0.7; // 1º tempo do compasso mais forte
  const move = MOVES[Math.floor(hash(Math.floor((b - downbeat) / 8)) * MOVES.length)];
  return {
    ...REST,
    bob: 13 * A * hit * accent,
    squash: 1 - 0.06 * A * hit * accent,
    sway: 6 * A * alt,
    head: 9 * A * Math.sin(Math.PI * b - 0.6),
    pulse: hit * accent,
    ...move(b, A, hit, alt),
  };
}

export default function Dancer({ className = 'items-center' }) {
  const track = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((s) => s.status === 'playing');
  const character = useDancerStore((s) => s.character);
  const rootRef = useRef(null);
  const trackerRef = useRef(null);
  const gridRef = useRef(null); // { id, grid }
  trackerRef.current ||= new BeatTracker();

  // A cada faixa: sorteia o personagem e calcula a grade de batidas da música inteira.
  useEffect(() => {
    useDancerStore.getState().pick(track?.id);
    trackerRef.current.reset();
    gridRef.current = null;
    if (!track) return;
    const controller = new AbortController();
    getBeatGrid(track, { signal: controller.signal })
      .then((grid) => {
        if (grid) gridRef.current = { id: track.id, grid };
      })
      .catch(() => {
        /* sem grade: segue com a detecção ao vivo */
      });
    return () => controller.abort();
  }, [track?.id]);

  useEffect(() => {
    const el = rootRef.current;
    const tracker = trackerRef.current;
    const pose = { ...REST };
    let raf;
    let last = performance.now() / 1000;
    let clock = null; // tempo da música suavizado (o currentTime vem em degraus em alguns navegadores)
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = performance.now() / 1000;
      const dt = Math.min(0.1, t - last);
      last = t;
      tracker.update(t, playing); // energia (e batida ao vivo enquanto a grade não fica pronta)

      const media = engine.audio.currentTime - outputLatency() + VISUAL_LEAD_S;
      if (clock == null || !playing || Math.abs(media - clock) > 0.15) clock = media;
      else clock += dt * engine.audio.playbackRate + (media - clock) * 0.1;

      const g = gridRef.current?.grid;
      const b = g ? gridPosition(g.beats, clock) : tracker.beats;
      const beatLen = g ? 60 / g.bpm : tracker.period;
      const target = targetPose({ b, downbeat: g?.downbeat || 0, energy: tracker.energy, playing, t, beatLen });

      const k = 1 - Math.exp(-dt / (playing ? 0.025 : 0.25));
      for (const name of VARS) {
        pose[name] += (target[name] - pose[name]) * k;
        el.style.setProperty(`--${name}`, pose[name].toFixed(3));
      }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const { name, Body } = DANCERS[character];
  return (
    <div ref={rootRef} className={`relative flex justify-center overflow-hidden ${className}`} style={REST_STYLE}>
      <svg viewBox="0 0 200 240" className="relative h-[60%] max-h-[280px] w-auto overflow-visible" role="img" aria-label={`${name} dançando`}>
        <defs>
          <radialGradient id="dancer-glow">
            <stop offset="0" stopColor="#bae6fd" stopOpacity=".9" />
            <stop offset=".3" stopColor="#1ea7ff" stopOpacity=".6" />
            <stop offset=".65" stopColor="#1ea7ff" stopOpacity=".18" />
            <stop offset="1" stopColor="#1ea7ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Luz atrás do personagem: acende a cada batida (mais forte no 1º tempo). */}
        <circle cx="100" cy="125" r="150" fill="url(#dancer-glow)" style={{ opacity: 'calc(0.25 + var(--pulse) * 0.75)' }} />
        <ellipse cx="100" cy="228" rx="54" ry="7" fill="#000" opacity=".35" />
        <Body />
      </svg>
    </div>
  );
}

const REST_STYLE = Object.fromEntries(VARS.map((n) => [`--${n}`, REST[n]]));
