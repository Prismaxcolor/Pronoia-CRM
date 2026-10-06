import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Almacen, Lote, Producto, Transformacion } from '@shared/types/index.js';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import SeleccionarMaterialModal from '../pesaje/SeleccionarMaterialModal';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import FotoMaterialPicker from '../pesaje/FotoMaterialPicker';
import { BloqueLoteDestino, BloqueMaterialDestino, SelectorTipoSalida } from './SalidaMixtaFila';
import { netoDe } from '../../lib/edicion-pesos-transformacion';
import { aNumero, filaSalidaNuevaVacia, type FilaSalidaNueva } from '../../lib/salida-nueva-edicion';

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

interface Props {
  transformacion: Transformacion;
  filas: FilaSalidaNueva[];
  onCambiar: (filas: FilaSalidaNueva[]) => void;
}

const OPCIONES_TIPO = [
  { tipo: 'lote' as const, etiqueta: 'Lote' },
  { tipo: 'material' as const, etiqueta: 'Material' },
];

/** Pesadas adicionales de una transformación completa: se agregan a las salidas existentes al guardar la edición. */
function SalidasNuevasEdicion({ transformacion: t, filas, onCambiar }: Props) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [selector, setSelector] = useState<{ uid: number; que: 'material' | 'lote' } | null>(null);

  useEffect(() => {
    Promise.all([obtenerProductos(), obtenerLotes(), obtenerAlmacenes()])
      .then(([p, l, a]) => { setProductos(p); setLotes(l); setAlmacenes(a); })
      .catch(() => undefined);
  }, []);

  const esPcb = t.categoria === 'pcb';
  const actualizar = (uid: number, campo: Partial<FilaSalidaNueva>) =>
    onCambiar(filas.map(f => (f.uid === uid ? { ...f, ...campo } : f)));
  const elegir = (id: string) => {
    if (selector) actualizar(selector.uid, selector.que === 'material' ? { productoId: id } : { loteDestinoId: id });
    setSelector(null);
  };

  return (
    <div className="border border-border rounded-xl p-3">
      <p className="text-sm font-medium text-text-primary mb-2">Pesadas adicionales (salidas nuevas)</p>
      <div className="space-y-3">
        {filas.map((f, i) => (
          <div key={f.uid} className="bg-surface-alt rounded-lg p-3 border border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">Salida nueva {i + 1}</span>
              <button type="button" onClick={() => onCambiar(filas.filter(x => x.uid !== f.uid))} className="text-text-muted hover:text-red-500" title="Quitar">
                <Trash2 size={14} />
              </button>
            </div>
            <SelectorTipoSalida valor={f.tipo} opciones={OPCIONES_TIPO} onCambiar={tipo => actualizar(f.uid, { tipo })} />
            {f.tipo === 'lote' && (
              <>
                {!esPcb && <p className="text-[11px] text-text-muted">Entra al lote el material de la transformación: {t.nombreProductoEntrada ?? '—'}.</p>}
                <BloqueLoteDestino
                  lote={lotes.find(l => l.id === f.loteDestinoId)}
                  almacenId={t.almacenId}
                  entradaDetalle={esPcb ? t.entradaDetalle : [{ productoId: t.productoEntradaId ?? '', nombreProducto: t.nombreProductoEntrada ?? '', pesoKg: 1 }]}
                  neto={netoDe(aNumero(f.pesoBruto) || 0, aNumero(f.tara) || 0)}
                  onElegirLote={() => setSelector({ uid: f.uid, que: 'lote' })}
                />
              </>
            )}
            {f.tipo === 'material' && (
              <BloqueMaterialDestino
                nombreProducto={productos.find(p => p.id === f.productoId)?.nombre}
                almacenId={f.almacenId}
                almacenes={almacenes}
                onElegirProducto={() => setSelector({ uid: f.uid, que: 'material' })}
                onCambiarAlmacen={almacenId => actualizar(f.uid, { almacenId })}
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Peso bruto (kg) *</label>
                <input type="number" step="any" min="0" value={f.pesoBruto} onChange={e => actualizar(f.uid, { pesoBruto: e.target.value })} className={inputClass} aria-label={`Peso bruto de la salida nueva ${i + 1}`} />
              </div>
              <div>
                <label className={labelClass}>Tara (kg)</label>
                <input type="number" step="any" min="0" value={f.tara} onChange={e => actualizar(f.uid, { tara: e.target.value })} className={inputClass} aria-label={`Tara de la salida nueva ${i + 1}`} />
              </div>
            </div>
            <FotoMaterialPicker
              label={esPcb ? 'Fotos de esta salida (opcional)' : 'Fotos de esta salida *'}
              fotos={f.fotos}
              onAgregar={files => actualizar(f.uid, { fotos: [...f.fotos, ...files.map(file => ({ tipo: 'nueva' as const, file, preview: URL.createObjectURL(file) }))] })}
              onQuitar={idx => actualizar(f.uid, { fotos: f.fotos.filter((_, k) => k !== idx) })}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => onCambiar([...filas, filaSalidaNuevaVacia(t)])}
          className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-border rounded-lg text-sm text-text-muted hover:text-text-secondary hover:border-brand-400 transition-colors"
        >
          <Plus size={14} /> Agregar pesaje
        </button>
        <p className="text-[11px] text-text-muted">
          Un lote de destino queda en el almacén de la transformación. Las pesadas nuevas suman al stock al guardar.
        </p>
      </div>
      {selector?.que === 'material' && (
        <SeleccionarMaterialModal productos={productos} onClose={() => setSelector(null)} onSeleccionar={elegir} />
      )}
      {selector?.que === 'lote' && (
        <SeleccionarEntidadModal
          titulo="Selecciona el lote de destino"
          entidades={lotes.filter(l => l.activo).map(l => ({ id: l.id, nombre: l.nombre, fotos: l.fotos }))}
          onClose={() => setSelector(null)}
          onSeleccionar={elegir}
        />
      )}
    </div>
  );
}

export default SalidasNuevasEdicion;
