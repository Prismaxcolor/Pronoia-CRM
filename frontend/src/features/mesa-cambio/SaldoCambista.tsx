import { describirSaldo, type SentidoSaldo } from '@shared/types/mesa-cambio';

/** El color solo acompaña: la etiqueta ("Pendiente por cobrar" / "Se le debe" / "Al día") es lo que dice quién debe. */
const CLASE_POR_SENTIDO: Record<SentidoSaldo, string> = {
  por_cobrar: 'text-brand-700',
  se_le_debe: 'text-amber-600',
  en_cero: 'text-text-secondary',
};

interface Props {
  saldo: number;
  /** 'linea' = una sola línea; 'bloque' = etiqueta pequeña arriba e importe grande abajo. */
  variante?: 'linea' | 'bloque';
}

function SaldoCambista({ saldo, variante = 'linea' }: Props) {
  const d = describirSaldo(saldo);
  const clase = CLASE_POR_SENTIDO[d.sentido];
  if (variante === 'linea') return <span className={`font-semibold tabular-nums ${clase}`}>{d.texto}</span>;
  return (
    <div className={clase}>
      <p className="text-xs font-medium uppercase tracking-wide">{d.etiqueta}</p>
      {d.sentido !== 'en_cero' && (
        <p className="text-2xl font-bold tabular-nums">USD {d.monto.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
      )}
    </div>
  );
}

export default SaldoCambista;
