import { useEffect, useRef } from 'react';
import { engine } from '../lib/audioEngine';
import { usePlayerStore } from '../store/playerStore';

/** Espectro em tempo real via AnalyserNode (Web Audio API). */
export default function Visualizer({ className = '', bars = 32 }) {
  const canvasRef = useRef(null);
  const playing = usePlayerStore((s) => s.status === 'playing');

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    let raf;
    let data;
    const heights = new Float32Array(bars);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = canvas;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const analyser = engine.analyser;
      if (analyser && playing) {
        data ||= new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
      }
      // Usa só ~70% inferior do espectro (onde está a energia musical) em escala log.
      const usable = data ? Math.floor(data.length * 0.7) : 0;
      const gap = 2;
      const bw = (w - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i++) {
        let target = 0;
        if (data && playing) {
          const idx = Math.min(usable - 1, Math.floor(Math.pow(usable, i / bars)));
          target = data[idx] / 255;
        }
        heights[i] += (target - heights[i]) * 0.35; // suaviza a queda ao pausar
        const bh = Math.max(2, heights[i] * h);
        const g = ctx.createLinearGradient(0, h, 0, h - bh);
        g.addColorStop(0, '#1db954');
        g.addColorStop(1, '#a7f3d0');
        ctx.fillStyle = g;
        ctx.fillRect(i * (bw + gap), h - bh, bw, bh);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [playing, bars]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
