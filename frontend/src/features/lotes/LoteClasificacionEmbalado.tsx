import { useState } from 'react';
import { PackageCheck, AlertTriangle } from 'lucide-react';
import { actualizarLote } from '../../services/lote-service';
import MarcarEmbaladoModal from './MarcarEmbaladoModal';
import { useToast } from '../../hooks/use-toast-context';
import type { ClaseLote, Lote } from '@shared/types/index.js';

const CLASES: Array<{ valor: ClaseLote; etiqueta: string }> = [
  { valor: 'exportacion', etiqueta: 'Exportación' },
  { valor: 'trabajo', etiqueta: 'Trabajo interno' },
  { valor: 'otro', etiqueta: 'Otro' },
];

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

const inputClass = 'px-2.5 py-1.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';

interface Props {
  lote: Lote;
  /** productos:editar. Sin permiso solo se ve (sin botones ni campos editables). */
  puedeEditar: boolean;
  /** Solo superadmin: cambiar la clase del lote (alimenta el contenedor que ve todo el equipo). */
  puedeConfigurar: boolean;
  onCambio: () => void;
}

/** Bloque del panel de Lotes: clase del lote y embalado por kilos. Todo es retrocompatible: si el backend aún no devuelve estos campos, no se muestra nada. */
function LoteClasificacionEmbalado({ lote, puedeEditar, puedeConfigurar, onCambio }: Props) {
  const toast = useToast();
  const [guardando, setGuardando] = useState(false);
  const [embalando, setEmbalando] = useState(false);

  if (lote.clase === undefined) return null; // backend sin la migración de clasificación

  const cambiarClase = async (clase: ClaseLote) => {
    setGuardando(true);
    const result = await actualizarLote(lote.id, { clase });
    setGuardando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`${lote.nombre}: clase actualizada.`);
    if (result.advertencia) toast.advertencia(result.advertencia);
    onCambio();
  };

  const emb = lote.embalado;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-medium text-text-secondary mb-1">Clase</label>
          <select
            value={lote.clase}
            disabled={!puedeConfigurar || guardando}
            onChange={e => cambiarClase(e.target.value as ClaseLote)}
            className={inputClass}
          >
            {CLASES.map(c => <option key={c.valor} value={c.valor}>{c.etiqueta}</option>)}
          </select>
        </div>
        {emb && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-medium">
              Embalado: {fmt(emb.embaladoKg)} kg
            </span>
            <span className="text-[11px] bg-surface-alt border border-border rounded-full px-2 py-0.5 text-text-secondary font-medium">
              En saca: {fmt(emb.enSacaKg)} kg
            </span>
            {emb.embaladoMayorQueStock && (
              <span className="flex items-center gap-1 text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5" title="Hay más kilos marcados como embalados que stock en el lote">
                <AlertTriangle size={11} /> Embalado &gt; stock
              </span>
            )}
          </div>
        )}
        {(puedeEditar || (emb?.embaladoMarcadoKg ?? 0) > 0) && (
          <button
            type="button"
            onClick={() => setEmbalando(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs font-medium text-text-secondary hover:border-brand-400 hover:text-brand-600 transition-colors"
          >
            <PackageCheck size={14} /> {puedeEditar ? 'Marcar kg como embalados' : 'Ver embalado'}
          </button>
        )}
      </div>

      {embalando && (
        <MarcarEmbaladoModal
          lote={lote}
          puedeEditar={puedeEditar}
          onClose={() => setEmbalando(false)}
          onCambio={onCambio}
        />
      )}
    </div>
  );
}

export default LoteClasificacionEmbalado;
