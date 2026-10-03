import { useCallback, useEffect, useRef, useState } from 'react';
import { estadoInicial, reducirAnimo, type Animo, type EventoAnimo, type EstadoAnimo } from './animo';
import { cargarConfig, guardarConfig, normalizarConfig, offsetPupila, type BlobConfig } from './config';

/** Config persistida por usuario en localStorage (con try/catch dentro de config.ts). */
export function useBlobConfig(userId: string | undefined) {
  const [config, setConfig] = useState<BlobConfig>(() => cargarConfig(userId));
  const cambiar = useCallback(
    (parcial: Partial<BlobConfig>) => {
      setConfig(prev => {
        const siguiente = normalizarConfig({ ...prev, ...parcial });
        guardarConfig(userId, siguiente);
        return siguiente;
      });
    },
    [userId],
  );
  return [config, cambiar] as const;
}

const TICK_MS = 1000;
const ACTIVIDAD_MIN_MS = 300;
const EVENTOS_ACTIVIDAD = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Ánimo de BLOB. El estado detallado vive en un ref; React solo re-renderiza
 * cuando cambia el `animo` (valor primitivo), no en cada movimiento del mouse.
 */
export function useBlobAnimo(inactividadMs: number, activo: boolean) {
  const estadoRef = useRef<EstadoAnimo>(estadoInicial(0));
  const ultimaActividadRef = useRef(0);
  const [animo, setAnimo] = useState<Animo>('normal');

  const enviar = useCallback(
    (evento: EventoAnimo) => {
      const nuevo = reducirAnimo(estadoRef.current, evento, Date.now(), inactividadMs);
      estadoRef.current = nuevo;
      setAnimo(nuevo.animo);
      return nuevo.animo;
    },
    [inactividadMs],
  );

  useEffect(() => {
    if (!activo) return;
    // Reinicia el reloj de inactividad al montar/activar (evita Date.now() en render).
    estadoRef.current = estadoInicial(Date.now());
    const id = window.setInterval(() => enviar({ tipo: 'tick' }), TICK_MS);
    const alActividad = () => {
      const ahora = Date.now();
      if (ahora - ultimaActividadRef.current < ACTIVIDAD_MIN_MS) return;
      ultimaActividadRef.current = ahora;
      enviar({ tipo: 'actividad' });
    };
    for (const ev of EVENTOS_ACTIVIDAD) window.addEventListener(ev, alActividad, { passive: true });
    return () => {
      window.clearInterval(id);
      for (const ev of EVENTOS_ACTIVIDAD) window.removeEventListener(ev, alActividad);
    };
  }, [activo, enviar]);

  return { animo, enviar };
}

const RADIO_PUPILA_PX = 4;
const INCLINACION_MAX_PX = 5;

/**
 * Hace que las pupilas sigan al cursor (o al último toque) escribiendo variables
 * CSS directamente en el DOM con requestAnimationFrame: cero re-renders de React.
 */
export function useBlobOjos(rootRef: React.RefObject<HTMLElement | null>, activo: boolean) {
  useEffect(() => {
    if (!activo) return;
    let raf = 0;
    let punto: { x: number; y: number } | null = null;

    const pintar = () => {
      raf = 0;
      const el = rootRef.current;
      if (!el || !punto) return;
      const r = el.getBoundingClientRect();
      const centro = { x: r.left + r.width / 2, y: r.top + r.height * 0.6 };
      const o = offsetPupila(centro, punto, RADIO_PUPILA_PX);
      el.style.setProperty('--px', o.x.toFixed(2));
      el.style.setProperty('--py', o.y.toFixed(2));
      const lean = offsetPupila(centro, punto, INCLINACION_MAX_PX);
      el.style.setProperty('--lx', `${lean.x.toFixed(1)}px`);
    };
    const programar = (x: number, y: number) => {
      punto = { x, y };
      if (!raf) raf = requestAnimationFrame(pintar);
    };
    const alMover = (e: PointerEvent) => programar(e.clientX, e.clientY);
    const alTocar = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) programar(t.clientX, t.clientY);
    };

    window.addEventListener('pointermove', alMover, { passive: true });
    window.addEventListener('touchstart', alTocar, { passive: true });
    window.addEventListener('touchmove', alTocar, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', alMover);
      window.removeEventListener('touchstart', alTocar);
      window.removeEventListener('touchmove', alTocar);
    };
  }, [rootRef, activo]);
}

/** Animaciones elásticas por Web Animations API (sin estado de React). */
const KEYFRAMES: Record<Exclude<Animo, 'normal' | 'dormido'> | 'soltar', { frames: Keyframe[]; ms: number }> = {
  feliz: {
    ms: 650,
    frames: [
      { transform: 'scale(1,1)' }, { transform: 'scale(1.22,0.78)', offset: 0.2 },
      { transform: 'scale(0.88,1.18) translateY(-8px)', offset: 0.45 }, { transform: 'scale(1.07,0.94)', offset: 0.7 },
      { transform: 'scale(1,1)' },
    ],
  },
  sorprendido: {
    ms: 450,
    frames: [{ transform: 'scale(1,1)' }, { transform: 'scale(0.9,1.2) translateY(-12px)', offset: 0.4 }, { transform: 'scale(1,1)' }],
  },
  risa: {
    ms: 900,
    frames: [
      { transform: 'translateY(0)' }, { transform: 'translateY(-10px) scale(0.95,1.08)', offset: 0.2 },
      { transform: 'translateY(0) scale(1.1,0.9)', offset: 0.4 }, { transform: 'translateY(-6px)', offset: 0.65 },
      { transform: 'translateY(0)' },
    ],
  },
  enojado: {
    ms: 500,
    frames: [
      { transform: 'translateX(0)' }, { transform: 'translateX(-6px) rotate(-3deg)', offset: 0.15 },
      { transform: 'translateX(6px) rotate(3deg)', offset: 0.35 }, { transform: 'translateX(-4px)', offset: 0.55 },
      { transform: 'translateX(4px)', offset: 0.75 }, { transform: 'translateX(0)' },
    ],
  },
  mareado: {
    ms: 1100,
    frames: [
      { transform: 'rotate(0)' }, { transform: 'rotate(-12deg)', offset: 0.2 }, { transform: 'rotate(10deg)', offset: 0.45 },
      { transform: 'rotate(-6deg)', offset: 0.7 }, { transform: 'rotate(0)' },
    ],
  },
  soltar: {
    ms: 550,
    frames: [
      { transform: 'scale(1,1)' }, { transform: 'scale(1.3,0.7)', offset: 0.25 },
      { transform: 'scale(0.85,1.2)', offset: 0.55 }, { transform: 'scale(1,1)' },
    ],
  },
};

export function animarBlob(el: HTMLElement | null, nombre: keyof typeof KEYFRAMES | Animo): void {
  if (!el || nombre === 'normal' || nombre === 'dormido') return;
  if (typeof el.animate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const { frames, ms } = KEYFRAMES[nombre];
  el.animate(frames, { duration: ms, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}
