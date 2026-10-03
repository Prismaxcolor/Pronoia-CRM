import { memo } from 'react';
import type { Animo } from './animo';
import type { Boca, Forma, Ojos } from './config';

interface Props {
  forma: Forma;
  color: string;
  ojos: Ojos;
  boca: Boca;
  animo: Animo;
  size: number;
}

const CUERPOS: Record<Forma, string> = {
  gota: 'M50 8 C50 8 82 42 82 64 C82 82 68 92 50 92 C32 92 18 82 18 64 C18 42 50 8 50 8 Z',
  redondo: 'M50 24 C74 24 88 40 88 58 C88 78 72 90 50 90 C28 90 12 78 12 58 C12 40 26 24 50 24 Z',
  cuadrado: 'M38 22 L62 22 Q84 22 84 44 L84 68 Q84 90 62 90 L38 90 Q16 90 16 68 L16 44 Q16 22 38 22 Z',
  triangulo: 'M50 14 Q57 14 62 24 L86 68 Q92 80 80 87 L20 87 Q8 80 14 68 L38 24 Q43 14 50 14 Z',
};

/** Altura (y) de los ojos según la forma, para que caigan dentro del cuerpo. */
const OJOS_Y: Record<Forma, number> = { gota: 60, redondo: 56, cuadrado: 54, triangulo: 66 };
const OJOS_DX: Record<Forma, number> = { gota: 13, redondo: 16, cuadrado: 17, triangulo: 11 };

function Cara({ ojos, boca, animo, y, dx }: { ojos: Ojos; boca: Boca; animo: Animo; y: number; dx: number }) {
  const xs = [50 - dx, 50 + dx];
  const radio = ojos === 'grandes' ? 9 : ojos === 'chiquitos' ? 4.5 : 7;
  const radioPupila = ojos === 'chiquitos' ? 2.5 : ojos === 'grandes' ? 4.5 : 3.5;
  const my = y + 17;

  const ojosDormidos = animo === 'dormido';
  const ojosContentos = animo === 'feliz' || animo === 'risa';

  return (
    <g>
      {xs.map((x, i) => {
        if (ojosDormidos) {
          return <path key={i} d={`M${x - 6} ${y} Q${x} ${y + 4} ${x + 6} ${y}`} stroke="#111" strokeWidth="2.2" fill="none" strokeLinecap="round" />;
        }
        if (ojosContentos) {
          return <path key={i} d={`M${x - 6} ${y + 2} Q${x} ${y - 6} ${x + 6} ${y + 2}`} stroke="#111" strokeWidth="2.6" fill="none" strokeLinecap="round" />;
        }
        if (animo === 'mareado') {
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={7} fill="#fff" />
              <path className="blob-remolino" d={`M${x} ${y} m-1 0 a2 2 0 1 1 2 2 a4 4 0 1 1 -4 -4 a6 6 0 1 1 6 6`} stroke="#111" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </g>
          );
        }
        const r = animo === 'sorprendido' ? radio + 2.5 : radio;
        return (
          <g key={i}>
            <g className="blob-ojo">
              {ojos === 'gafas' ? (
                <rect x={x - 8} y={y - 6} width="16" height="12" rx="4" fill="#111" />
              ) : (
                <circle cx={x} cy={y} r={r} fill="#fff" />
              )}
              <circle
                className="blob-pupila"
                cx={x}
                cy={y}
                r={ojos === 'gafas' ? 2 : animo === 'sorprendido' ? radioPupila - 1 : radioPupila}
                fill={ojos === 'gafas' ? '#9ca3af' : '#111'}
              />
            </g>
            {animo === 'enojado' && (
              <path d={i === 0 ? `M${x - 9} ${y - 12} L${x + 7} ${y - 6}` : `M${x + 9} ${y - 12} L${x - 7} ${y - 6}`} stroke="#111" strokeWidth="2.6" strokeLinecap="round" />
            )}
          </g>
        );
      })}
      <BocaDibujo boca={boca} animo={animo} y={my} />
    </g>
  );
}

function BocaDibujo({ boca, animo, y }: { boca: Boca; animo: Animo; y: number }) {
  const trazo = { stroke: '#111', strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' as const };
  if (animo === 'dormido') return <ellipse cx="50" cy={y} rx="2.5" ry="2" fill="#111" opacity="0.7" />;
  if (animo === 'sorprendido') return <ellipse cx="50" cy={y} rx="4" ry="5" fill="#111" />;
  if (animo === 'risa') {
    return <path d={`M40 ${y - 3} Q50 ${y + 12} 60 ${y - 3} Z`} fill="#111" stroke="#111" strokeWidth="1.5" strokeLinejoin="round" />;
  }
  if (animo === 'enojado') return <path d={`M42 ${y + 3} Q50 ${y - 4} 58 ${y + 3}`} {...trazo} />;
  if (animo === 'mareado') return <path d={`M41 ${y} Q45 ${y - 3} 49 ${y} T57 ${y}`} {...trazo} />;
  if (animo === 'feliz') return <path d={`M40 ${y - 2} Q50 ${y + 9} 60 ${y - 2}`} {...trazo} />;
  switch (boca) {
    case 'boquita':
      return <ellipse cx="50" cy={y} rx="3" ry="2.5" fill="#111" />;
    case 'neutra':
      return <path d={`M42 ${y} L58 ${y}`} {...trazo} />;
    case 'dientes':
      return (
        <g>
          <path d={`M39 ${y - 3} Q50 ${y + 9} 61 ${y - 3} Z`} fill="#fff" stroke="#111" strokeWidth="2" strokeLinejoin="round" />
          <path d={`M50 ${y - 2} L50 ${y + 4}`} stroke="#111" strokeWidth="1.2" />
        </g>
      );
    default:
      return <path d={`M41 ${y - 2} Q50 ${y + 7} 59 ${y - 2}`} {...trazo} />;
  }
}

/** Dibujo de BLOB. Los ojos siguen al cursor vía las variables CSS --px/--py del <svg>. */
function BlobSvgBase({ forma, color, ojos, boca, animo, size }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-hidden="true" focusable="false" className="block overflow-visible">
      <ellipse cx="50" cy="94" rx="26" ry="3.5" fill="#000" opacity="0.12" />
      <g className="blob-cuerpo">
        <path d={CUERPOS[forma]} fill={color} />
        <path d={CUERPOS[forma]} fill="url(#blob-brillo)" opacity="0.5" />
        {animo === 'enojado' && <path d={CUERPOS[forma]} fill="#ef4444" opacity="0.35" />}
        <Cara ojos={ojos} boca={boca} animo={animo} y={OJOS_Y[forma]} dx={OJOS_DX[forma]} />
      </g>
      {animo === 'dormido' && (
        <text className="blob-z" x="72" y="30" fontSize="14" fontWeight="700" fill="#6B7280">z</text>
      )}
      <defs>
        <radialGradient id="blob-brillo" cx="35%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export const BlobSvg = memo(BlobSvgBase);
