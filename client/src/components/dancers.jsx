/**
 * Personagens do dançarino. Cada um é um SVG (viewBox 200×240, pés em y≈226) cujas partes
 * giram/deslocam conforme variáveis CSS que o `Dancer` atualiza a cada quadro:
 *   --bob (px, + = abaixa) --sway (graus) --hip (px) --squash (escala Y)
 *   --armL/--armR (graus, + = levanta para fora) --legL/--legR (graus, + = chuta para fora)
 *   --head (graus) --pulse (0..1, ataque da batida)
 * transform-origin em px corresponde às unidades do viewBox (transform-box: view-box).
 */

const v = (name, unit, k = 1) => `calc(var(--${name}) * ${k}${unit})`;

function Part({ o, t, children }) {
  return <g style={{ transformOrigin: `${o[0]}px ${o[1]}px`, transform: t }}>{children}</g>;
}

/** Corpo inteiro balança sobre os pés; o tronco (acima do quadril) sobe/desce e achata. */
function Rig({ legs, behind, upper, hipY = 170 }) {
  return (
    <Part o={[100, 226]} t={`translateX(${v('hip', 'px')}) rotate(${v('sway', 'deg')})`}>
      {behind}
      {legs}
      <Part o={[100, hipY]} t={`translateY(${v('bob', 'px')}) scaleY(var(--squash))`}>
        {upper}
      </Part>
    </Part>
  );
}

const armL = (x, y) => (children) => (
  <Part o={[x, y]} t={`rotate(${v('armL', 'deg')})`}>{children}</Part>
);
const armR = (x, y) => (children) => (
  <Part o={[x, y]} t={`rotate(${v('armR', 'deg', -1)})`}>{children}</Part>
);
const legL = (x, y) => (children) => (
  <Part o={[x, y]} t={`rotate(${v('legL', 'deg')})`}>{children}</Part>
);
const legR = (x, y) => (children) => (
  <Part o={[x, y]} t={`rotate(${v('legR', 'deg', -1)})`}>{children}</Part>
);
const head = (x, y) => (children) => (
  <Part o={[x, y]} t={`rotate(${v('head', 'deg')})`}>{children}</Part>
);

function Cat() {
  const fur = '#f59e0b';
  const dark = '#b45309';
  const light = '#fde68a';
  return (
    <Rig
      behind={
        <Part o={[128, 172]} t={`rotate(${v('sway', 'deg', 3)})`}>
          <path d="M128 172c22-6 34-24 30-48-2-10 8-12 10-2 6 30-10 56-38 60z" fill={dark} />
        </Part>
      }
      legs={
        <>
          {legL(88, 168)(<><rect x="80" y="166" width="17" height="54" rx="8" fill={fur} /><ellipse cx="86" cy="222" rx="13" ry="7" fill={light} /></>)}
          {legR(112, 168)(<><rect x="103" y="166" width="17" height="54" rx="8" fill={fur} /><ellipse cx="114" cy="222" rx="13" ry="7" fill={light} /></>)}
        </>
      }
      upper={
        <>
          {armL(70, 122)(<><rect x="62" y="118" width="15" height="48" rx="7.5" fill={fur} /><circle cx="69.5" cy="166" r="9" fill={light} /></>)}
          {armR(130, 122)(<><rect x="123" y="118" width="15" height="48" rx="7.5" fill={fur} /><circle cx="130.5" cy="166" r="9" fill={light} /></>)}
          <ellipse cx="100" cy="145" rx="36" ry="40" fill={fur} />
          <ellipse cx="100" cy="152" rx="22" ry="27" fill={light} />
          {head(100, 112)(
            <>
              <path d="M66 62 70 22l28 26z" fill={fur} />
              <path d="M134 62 130 22l-28 26z" fill={fur} />
              <path d="M73 52 75 32l14 14z" fill="#fca5a5" />
              <path d="M127 52 125 32l-14 14z" fill="#fca5a5" />
              <circle cx="100" cy="76" r="40" fill={fur} />
              <path d="M84 52h4M96 48h8M112 52h4" stroke={dark} strokeWidth="4" strokeLinecap="round" />
              <ellipse cx="85" cy="74" rx="7" ry="9" fill="#111" />
              <ellipse cx="115" cy="74" rx="7" ry="9" fill="#111" />
              <circle cx="87" cy="71" r="2.5" fill="#fff" />
              <circle cx="117" cy="71" r="2.5" fill="#fff" />
              <path d="M95 88h10l-5 5z" fill="#f472b6" />
              <path d="M100 93q-6 8-12 3M100 93q6 8 12 3" stroke="#111" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              <path d="M60 86l18 2M60 96l18-3M140 86l-18 2M140 96l-18-3" stroke="#78350f" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </>
      }
    />
  );
}

function Frog() {
  const skin = '#22c55e';
  const dark = '#15803d';
  const belly = '#bbf7d0';
  return (
    <Rig
      hipY={180}
      legs={
        <>
          {legL(84, 182)(<><path d="M86 176c-26 4-30 28-22 44h18c-6-12 0-24 12-30z" fill={dark} /><path d="M58 224c4-8 24-8 30 0z" fill={skin} /></>)}
          {legR(116, 182)(<><path d="M114 176c26 4 30 28 22 44h-18c6-12 0-24-12-30z" fill={dark} /><path d="M142 224c-4-8-24-8-30 0z" fill={skin} /></>)}
        </>
      }
      upper={
        <>
          {armL(68, 140)(<><rect x="61" y="136" width="13" height="42" rx="6.5" fill={skin} /><path d="M58 178l9-6 9 6-9 6z" fill={dark} /></>)}
          {armR(132, 140)(<><rect x="126" y="136" width="13" height="42" rx="6.5" fill={skin} /><path d="M124 178l9-6 9 6-9 6z" fill={dark} /></>)}
          <ellipse cx="100" cy="158" rx="38" ry="34" fill={skin} />
          <ellipse cx="100" cy="166" rx="25" ry="22" fill={belly} />
          {head(100, 128)(
            <>
              <ellipse cx="100" cy="104" rx="50" ry="32" fill={skin} />
              <circle cx="74" cy="76" r="19" fill={skin} />
              <circle cx="126" cy="76" r="19" fill={skin} />
              <circle cx="74" cy="76" r="12" fill="#fff" />
              <circle cx="126" cy="76" r="12" fill="#fff" />
              <circle cx="76" cy="78" r="6" fill="#111" />
              <circle cx="124" cy="78" r="6" fill="#111" />
              <path d="M66 108q34 26 68 0" stroke={dark} strokeWidth="4" fill="none" strokeLinecap="round" />
              <circle cx="66" cy="104" r="5" fill="#f9a8d4" opacity=".7" />
              <circle cx="134" cy="104" r="5" fill="#f9a8d4" opacity=".7" />
              <circle cx="93" cy="96" r="2" fill={dark} />
              <circle cx="107" cy="96" r="2" fill={dark} />
            </>
          )}
        </>
      }
    />
  );
}

function Penguin() {
  const black = '#1f2937';
  const orange = '#fb923c';
  return (
    <Rig
      hipY={200}
      legs={
        <>
          {legL(88, 205)(<path d="M76 222c0-12 8-18 14-18s8 6 6 18z" fill={orange} />)}
          {legR(112, 205)(<path d="M124 222c0-12-8-18-14-18s-8 6-6 18z" fill={orange} />)}
        </>
      }
      upper={
        <>
          {armL(66, 122)(<path d="M66 118c-12 18-14 46-6 64 8-10 12-36 10-62z" fill={black} />)}
          {armR(134, 122)(<path d="M134 118c12 18 14 46 6 64-8-10-12-36-10-62z" fill={black} />)}
          <ellipse cx="100" cy="150" rx="38" ry="58" fill={black} />
          <ellipse cx="100" cy="160" rx="26" ry="44" fill="#f8fafc" />
          {head(100, 104)(
            <>
              <circle cx="100" cy="72" r="36" fill={black} />
              <path d="M76 82c0-18 10-28 24-28s24 10 24 28c0 12-10 18-24 18s-24-6-24-18z" fill="#f8fafc" />
              <circle cx="88" cy="72" r="6" fill="#111" />
              <circle cx="112" cy="72" r="6" fill="#111" />
              <circle cx="90" cy="70" r="2" fill="#fff" />
              <circle cx="114" cy="70" r="2" fill="#fff" />
              <path d="M90 84h20l-10 10z" fill={orange} />
              <circle cx="80" cy="88" r="4" fill="#fda4af" opacity=".7" />
              <circle cx="120" cy="88" r="4" fill="#fda4af" opacity=".7" />
            </>
          )}
        </>
      }
    />
  );
}

function Robot() {
  const metal = '#94a3b8';
  const dark = '#475569';
  return (
    <Rig
      hipY={172}
      legs={
        <>
          {legL(88, 170)(<><rect x="80" y="168" width="16" height="48" rx="3" fill={dark} /><rect x="72" y="214" width="28" height="11" rx="3" fill={metal} /></>)}
          {legR(112, 170)(<><rect x="104" y="168" width="16" height="48" rx="3" fill={dark} /><rect x="100" y="214" width="28" height="11" rx="3" fill={metal} /></>)}
        </>
      }
      upper={
        <>
          {armL(64, 122)(<><rect x="57" y="118" width="14" height="48" rx="3" fill={dark} /><circle cx="64" cy="122" r="8" fill={metal} /><path d="M56 166h16v10l-4-4h-8l-4 4z" fill={metal} /></>)}
          {armR(136, 122)(<><rect x="129" y="118" width="14" height="48" rx="3" fill={dark} /><circle cx="136" cy="122" r="8" fill={metal} /><path d="M128 166h16v10l-4-4h-8l-4 4z" fill={metal} /></>)}
          <rect x="68" y="112" width="64" height="62" rx="8" fill={metal} />
          <rect x="80" y="124" width="40" height="26" rx="4" fill="#0f172a" />
          <rect x="84" y="140" width="6" height="6" fill="#22d3ee" style={{ opacity: 'calc(0.3 + var(--pulse) * 0.7)' }} />
          <rect x="94" y="134" width="6" height="12" fill="#a3e635" />
          <rect x="104" y="130" width="6" height="16" fill="#f472b6" style={{ opacity: 'calc(0.3 + var(--pulse) * 0.7)' }} />
          <circle cx="100" cy="162" r="5" fill="#f43f5e" />
          {head(100, 110)(
            <>
              <path d="M100 48V30" stroke={dark} strokeWidth="4" />
              <circle cx="100" cy="27" r="7" fill="#f43f5e" />
              <circle cx="100" cy="27" r="14" fill="#f43f5e" style={{ opacity: 'calc(var(--pulse) * 0.45)' }} />
              <rect x="66" y="46" width="68" height="60" rx="12" fill={metal} />
              <rect x="58" y="66" width="8" height="20" rx="3" fill={dark} />
              <rect x="134" y="66" width="8" height="20" rx="3" fill={dark} />
              <rect x="74" y="56" width="52" height="40" rx="8" fill="#0f172a" />
              <circle cx="88" cy="72" r="7" fill="#22d3ee" />
              <circle cx="112" cy="72" r="7" fill="#22d3ee" />
              <path d="M88 86q12 8 24 0" stroke="#22d3ee" strokeWidth="3" fill="none" strokeLinecap="round" />
            </>
          )}
        </>
      }
    />
  );
}

function StickFigure() {
  const line = { stroke: '#f4f4f5', strokeWidth: 7, strokeLinecap: 'round', fill: 'none' };
  return (
    <Rig
      hipY={160}
      legs={
        <>
          {legL(100, 160)(<path d="M100 160 84 222" {...line} />)}
          {legR(100, 160)(<path d="M100 160 116 222" {...line} />)}
        </>
      }
      upper={
        <>
          {armL(100, 108)(<path d="M100 108 84 140 78 166" {...line} />)}
          {armR(100, 108)(<path d="M100 108 116 140 122 166" {...line} />)}
          <path d="M100 98v62" {...line} />
          {head(100, 98)(
            <>
              <circle cx="100" cy="68" r="26" {...line} />
              <circle cx="91" cy="64" r="3.5" fill="#f4f4f5" />
              <circle cx="109" cy="64" r="3.5" fill="#f4f4f5" />
              <path d="M90 76q10 9 20 0" stroke="#f4f4f5" strokeWidth="4" fill="none" strokeLinecap="round" />
              <path d="M72 52q28-26 56 0" stroke="#1ed760" strokeWidth="6" fill="none" strokeLinecap="round" />
              <rect x="66" y="56" width="10" height="16" rx="4" fill="#1ed760" />
              <rect x="124" y="56" width="10" height="16" rx="4" fill="#1ed760" />
            </>
          )}
        </>
      }
    />
  );
}

export const DANCERS = [
  { name: 'Gato', Body: Cat },
  { name: 'Sapo', Body: Frog },
  { name: 'Pinguim', Body: Penguin },
  { name: 'Robô', Body: Robot },
  { name: 'Boneco', Body: StickFigure },
];
