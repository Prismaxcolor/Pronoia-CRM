import { porcentajeProgreso } from './progreso';

/** CUÁNDO USARLA: avance hacia una meta (kg hacia el contenedor, % de un presupuesto). Siempre acompáñala con un texto
 *  que diga la cifra ("Faltan 3.200 kg"): la barra sola no basta. Para partes de un total usa BarraApilada. */
export interface BarraProgresoProps {
  valor: number;
  /** Meta; por defecto 100 (valor ya en %). */
  max?: number;
  /** Texto accesible ("Progreso hacia la meta del contenedor"). */
  etiqueta: string;
  tono?: 'marca' | 'exito' | 'aviso' | 'peligro';
  /** Alto de la barra (clase Tailwind). */
  alto?: string;
}

const TONOS = {
  marca: { pista: 'bg-brand-100', relleno: 'bg-brand-600' },
  exito: { pista: 'bg-emerald-100', relleno: 'bg-emerald-600' },
  aviso: { pista: 'bg-amber-100', relleno: 'bg-amber-500' },
  peligro: { pista: 'bg-red-100', relleno: 'bg-red-600' },
} as const;

function BarraProgreso({ valor, max = 100, etiqueta, tono = 'marca', alto = 'h-3' }: BarraProgresoProps) {
  const pct = porcentajeProgreso(valor, max);
  const t = TONOS[tono];
  return (
    <div
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
      aria-label={etiqueta}
      className={`${alto} w-full overflow-hidden rounded-full ${t.pista}`}
    >
      <div className={`h-full rounded-full ${t.relleno} transition-[width]`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default BarraProgreso;
