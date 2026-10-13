import { useEffect, useState } from 'react';
import { MusicIcon } from './Icons';

/** Capa com cascata: Cover Art Archive -> thumbnail da fonte de áudio -> placeholder. */
export default function Artwork({ track, className = '' }) {
  const candidates = [track?.thumbnail, track?.fallbackThumbnail].filter(Boolean);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => setAttempt(0), [track?.id]);

  const src = candidates[attempt];
  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-surface-600 text-zinc-500 ${className}`}>
        <MusicIcon className="h-1/3 w-1/3" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setAttempt((a) => a + 1)}
      className={`bg-surface-600 object-cover ${className}`}
    />
  );
}
