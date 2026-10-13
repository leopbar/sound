const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true };

export const PlayIcon = (p) => (
  <svg {...base} {...p}><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" /></svg>
);
export const PauseIcon = (p) => (
  <svg {...base} {...p}><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
);
export const NextIcon = (p) => (
  <svg {...base} {...p}><path d="M5 5.5v13a1 1 0 0 0 1.53.85L16 13.5V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.5L6.53 4.65A1 1 0 0 0 5 5.5z" /></svg>
);
export const PrevIcon = (p) => (
  <svg {...base} {...p}><path d="M19 5.5v13a1 1 0 0 1-1.53.85L8 13.5V18a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v4.5l9.47-5.85A1 1 0 0 1 19 5.5z" /></svg>
);
export const VolumeIcon = ({ level = 1, muted, ...p }) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" />
    {muted || level === 0 ? (
      <path d="m23 9-6 6M17 9l6 6" />
    ) : (
      <>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        {level > 0.5 && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
      </>
    )}
  </svg>
);
export const SearchIcon = (p) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);
export const MusicIcon = (p) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.5" {...p}>
    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);
export const ShuffleIcon = (p) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
);
export const RestoreIcon = (p) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
  </svg>
);
export const GripIcon = (p) => (
  <svg {...base} {...p}>
    {[6, 12, 18].map((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
  </svg>
);
export const Spinner = ({ className = '' }) => (
  <svg className={`animate-spin ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
