import { useEffect, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';

const SHOW_AFTER_S = 1; // faixa já pronta no servidor ou no aparelho começa antes disso
const USUAL_MAX_S = 20;

// Humor do bonequinho conforme os segundos de espera. Uma faixa nunca tocada costuma levar
// 10 a 13 s: a cara de bravo tem que aparecer dentro desse tempo, não só depois dos 20 s.
const moodAt = (s) => (s >= 30 ? 4 : s > USUAL_MAX_S ? 3 : s >= 10 ? 2 : s >= 5 ? 1 : 0);

// Uma fala por humor, sorteada a cada carregamento. Curtas: no celular não podem ser cortadas.
const LINES = [
  ['Tô esperando…', 'Já vai tocar… dizem.', 'Peraí, o YouTube tá acordando…'],
  [
    'O baterista se atrasou de novo…',
    'Ainda tão afinando o violão…',
    'Rebobinando a fita com a caneta…',
    'Anda, YouTube, não tenho o dia todo!',
  ],
  ['Hoje ainda, né?', 'Dava tempo de eu mesmo cantar…', 'Tô ficando velho aqui…', 'Foram buscar a música a pé?'],
  ['Agora já é falta de respeito!', 'Vou reclamar com o gerente!', 'Essa música vem de navio, só pode…'],
  ['Zzz… me acorda quando tocar.'],
];

const SKIN = '#fcd9b6';
const INK = '#18181b';

/**
 * Bonequinho de braços cruzados batendo o pé. Tudo é desenhado sempre; o humor (`data-mood`)
 * só liga/desliga partes e acelera as animações pelo CSS (`.waiter` em index.css). Trocar os
 * elementos a cada humor reiniciaria as animações.
 */
function Waiter({ mood }) {
  const face = { stroke: INK, strokeWidth: 1.8, strokeLinecap: 'round', fill: 'none' };
  return (
    <svg className="waiter h-16 w-14 shrink-0 overflow-visible" data-mood={mood} viewBox="0 0 64 72" aria-hidden="true">
      <ellipse cx="32" cy="69.5" rx="17" ry="2.5" fill="#000" opacity=".12" />
      <g className="waiter-all">
        {/* Pernas: a esquerda parada, o pé direito batendo no chão */}
        <rect x="23" y="50" width="6" height="15" rx="3" fill="#27272a" />
        <path d="M17 68q0-5 6-5h6v5z" fill={INK} />
        <rect x="35" y="50" width="6" height="15" rx="3" fill="#27272a" />
        <path className="waiter-foot" d="M35 68v-5h6q6 0 6 5z" fill={INK} />

        <g className="waiter-body">
          <rect x="18" y="30" width="28" height="25" rx="9" fill="#1ea7ff" />
          {/* Braços cruzados */}
          <path d="M19.5 37q1 10 19 8" stroke="#0b6fb8" strokeWidth="5.5" fill="none" strokeLinecap="round" />
          <path d="M44.5 37q-1 10-19 6.5" stroke="#0b8fe6" strokeWidth="5.5" fill="none" strokeLinecap="round" />
          <circle cx="39.5" cy="45" r="3.2" fill={SKIN} />
          <circle cx="24.5" cy="43.5" r="3.2" fill={SKIN} />

          <circle className="waiter-face" cx="32" cy="17" r="14" />
          <path d="M19 13q1-12 13-12 12 0 13 12-5-6-13-6t-13 6z" fill="#3f2a1d" />
          <path className="waiter-brow-l" d="M21.5 12.5h8" {...face} strokeWidth="2.2" />
          <path className="waiter-brow-r" d="M34.5 12.5h8" {...face} strokeWidth="2.2" />

          {/* Acordado: olhos semicerrados (que reviram de vez em quando) e boca torta */}
          <g className="waiter-awake">
            <path d="M22.5 16.8h7M34.5 16.8h7" {...face} strokeWidth="1.4" />
            <g className="waiter-pupils">
              <circle cx="26" cy="19" r="2" fill={INK} />
              <circle cx="38" cy="19" r="2" fill={INK} />
            </g>
            <path d="M27 26.5q5-3.2 10 0" {...face} />
          </g>
          {/* Dormindo (desistiu de esperar) */}
          <g className="waiter-asleep">
            <path d="M23 18.5q3 2.2 6 0M35 18.5q3 2.2 6 0" {...face} />
            <ellipse cx="32" cy="26" rx="2" ry="2.6" fill={INK} />
          </g>
        </g>

        {/* Veia de raiva */}
        <path
          className="waiter-vein"
          d="M46 3.5q3 .5 3-2.5M54 3.5q-3 .5-3-2.5M46 6.5q3-.5 3 2.5M54 6.5q-3-.5-3 2.5"
          stroke="#ef4444"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
        {/* Fumaça saindo das orelhas */}
        <circle className="waiter-steam" cx="14" cy="15" r="3.2" fill="#a1a1aa" />
        <circle className="waiter-steam waiter-steam-2" cx="50" cy="15" r="3.2" fill="#a1a1aa" />
        {/* Zzz */}
        <text className="waiter-z" x="47" y="10" fontSize="9" fontWeight="700" fill="#52525b">z</text>
        <text className="waiter-z waiter-z-2" x="53" y="4" fontSize="12" fontWeight="700" fill="#52525b">z</text>
      </g>
    </svg>
  );
}

/**
 * Enquanto a faixa carrega: o bonequinho impaciente, uma fala dele e os segundos passando (uma
 * faixa nunca tocada pode levar até ~20 s: o servidor resolve o vídeo e espera o YouTube liberar
 * o áudio). A contagem recomeça ao trocar de faixa. Só informa: `pointer-events-none`, os cliques
 * passam para o que está atrás.
 */
export default function LoadingNotice() {
  const loading = usePlayerStore((s) => s.status === 'loading');
  const trackId = usePlayerStore((s) => s.queue[s.index]?.id);
  const [seconds, setSeconds] = useState(0);
  const [pick, setPick] = useState(0);

  useEffect(() => {
    setSeconds(0);
    if (!loading) return;
    setPick(Math.floor(Math.random() * 1000));
    const t0 = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(timer);
  }, [loading, trackId]);

  if (!loading || seconds < SHOW_AFTER_S) return null;
  const mood = moodAt(seconds);
  const lines = LINES[mood];
  return (
    <div
      role="status"
      className="pointer-events-none absolute bottom-full left-1/2 mb-3 flex w-max max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-xl bg-zinc-100 py-1.5 pl-2 pr-4 text-zinc-900 shadow-xl"
    >
      <Waiter mood={mood} />
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug">{lines[pick % lines.length]}</p>
        <p className="text-xs leading-snug text-zinc-500">
          {seconds <= USUAL_MAX_S ? `Carregando… pode levar até ${USUAL_MAX_S} s` : 'Ainda carregando a música…'}
        </p>
      </div>
      <span aria-hidden="true" className="shrink-0 text-base font-bold tabular-nums">
        {seconds} s
      </span>
    </div>
  );
}
