import { useEffect, useRef } from 'react';
import { usePlayerStore, selectCurrentTrack } from '../store/playerStore';
import { useDancerStore } from '../store/dancerStore';
import { BeatTracker } from '../lib/beatTracker';
import { DANCERS } from './dancers';

const TAU = Math.PI * 2;
const VARS = ['bob', 'sway', 'hip', 'squash', 'armL', 'armR', 'legL', 'legR', 'head', 'pulse'];
const REST = { bob: 0, sway: 0, hip: 0, squash: 1, armL: 10, armR: 10, legL: 0, legR: 0, head: 0, pulse: 0 };

/** Passos de dança; trocam a cada 8 batidas. `b` = batidas (contínuo), `A` = intensidade 0..1. */
const MOVES = [
  // Sobe e desce socando o ar.
  (b, A, down, alt) => ({ armL: 25 + 70 * A * (1 - down), armR: 25 + 70 * A * (1 - down), legL: 4 * A, legR: 4 * A }),
  // Requebra de lado, um braço de cada vez.
  (b, A, down, alt) => ({ armL: 25 + 60 * A * Math.max(0, alt), armR: 25 + 60 * A * Math.max(0, -alt), sway: 12 * A * alt, hip: 8 * A * alt }),
  // Mãos para o alto empurrando o teto.
  (b, A, down) => ({ armL: 150 - 35 * A * down, armR: 150 - 35 * A * down }),
  // Um braço acenando lá em cima, o outro marcando o tempo.
  (b, A, down, alt) => ({ armL: 145 + 25 * A * Math.sin(TAU * b), armR: 20 + 25 * A * Math.abs(alt) }),
  // Passinho: pernas alternadas, braços balançando.
  (b, A, down, alt) => ({
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

function targetPose(tracker, playing, t) {
  if (!playing) {
    // Parado: só "respira".
    return { ...REST, bob: 1.5 * Math.sin(t * 2), head: 2 * Math.sin(t * 1.3) };
  }
  const A = Math.min(1, 0.3 + 0.8 * tracker.energy);
  const b = tracker.beats + 0.05; // leve adiantamento compensa a suavização
  const down = (0.5 + 0.5 * Math.cos(TAU * b)) ** 2; // 1 na batida
  const alt = Math.sin(Math.PI * b); // muda de lado a cada batida
  const pulse = tracker.pulse;
  const move = MOVES[Math.floor(hash(Math.floor(b / 8)) * MOVES.length)];
  return {
    ...REST,
    bob: 12 * A * down + 5 * pulse,
    squash: 1 - 0.05 * A * down - 0.04 * pulse,
    sway: 6 * A * alt,
    head: 9 * A * Math.sin(Math.PI * b - 0.6),
    pulse,
    ...move(b, A, down, alt),
  };
}

export default function Dancer({ className = '' }) {
  const track = usePlayerStore(selectCurrentTrack);
  const playing = usePlayerStore((s) => s.status === 'playing');
  const character = useDancerStore((s) => s.character);
  const rootRef = useRef(null);
  const trackerRef = useRef(null);
  trackerRef.current ||= new BeatTracker();

  useEffect(() => {
    useDancerStore.getState().pick(track?.id);
    trackerRef.current.reset();
  }, [track?.id]);

  useEffect(() => {
    const el = rootRef.current;
    const tracker = trackerRef.current;
    const pose = { ...REST };
    let raf;
    let last = performance.now() / 1000;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = performance.now() / 1000;
      const dt = Math.min(0.1, t - last);
      last = t;
      tracker.update(t, playing);
      const target = targetPose(tracker, playing, t);
      const k = 1 - Math.exp(-dt / (playing ? 0.05 : 0.25));
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
    <div ref={rootRef} className={`relative flex items-center justify-center overflow-hidden ${className}`} style={REST_STYLE}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 45% 55% at 50% 60%, rgba(30,215,96,.28), transparent 70%)',
          opacity: 'calc(0.35 + var(--pulse) * 0.65)',
        }}
      />
      <svg viewBox="0 0 200 240" className="relative h-full max-h-[70vh] w-auto" role="img" aria-label={`${name} dançando`}>
        <ellipse cx="100" cy="228" rx="54" ry="7" fill="#000" opacity=".35" />
        <Body />
      </svg>
    </div>
  );
}

const REST_STYLE = Object.fromEntries(VARS.map((n) => [`--${n}`, REST[n]]));
