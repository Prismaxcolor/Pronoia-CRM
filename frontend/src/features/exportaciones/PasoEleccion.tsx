import { Link } from 'react-router-dom';
import type { PackingListDetalle, PackingListResumen } from '@shared/types/index.js';
import type { OpcionCliente } from '../packing-list/formulario';
import { formatearFechaDocumento } from '../../lib/packing-list';

const INPUT = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-70';
const LABEL = 'block text-xs font-medium text-text-secondary mb-1';

interface Props {
  esNueva: boolean;
  packingLists: PackingListResumen[];
  detalle: PackingListDetalle | null;
  clientes: OpcionCliente[];
  clienteId: string;
  puedeEditar: boolean;
  onElegirPackingList: (id: string) => void;
  onCambiarCliente: (id: string) => void;
}

function SelectorPackingList({ packingLists, valor, onElegir }: { packingLists: PackingListResumen[]; valor: string; onElegir: (id: string) => void }) {
  return (
    <div>
      <label htmlFor="exp-packing" className={LABEL}>Packing list *</label>
      <select id="exp-packing" className={INPUT} value={valor} onChange={e => onElegir(e.target.value)}>
        <option value="">Elige un packing list</option>
        {packingLists.map(p => <option key={p.id} value={p.id}>{p.contenedor} · {formatearFechaDocumento(p.fecha, 'es')}</option>)}
      </select>
      <p className="mt-1 text-[11px] text-text-muted">
        {packingLists.length === 0 ? 'Todavía no hay packing lists. ' : '¿No está el que buscas? '}
        <Link to="/packing-list/nuevo" className="font-medium text-brand-700 underline underline-offset-2">Crea un packing list nuevo</Link>
        {' '}y vuelve aquí.
      </p>
    </div>
  );
}

function SelectorCliente({ clientes, clienteId, deshabilitado, onCambiar }: {
  clientes: OpcionCliente[]; clienteId: string; deshabilitado: boolean; onCambiar: (id: string) => void;
}) {
  return (
    <div>
      <label htmlFor="exp-cliente" className={LABEL}>Cliente internacional *</label>
      <select id="exp-cliente" className={INPUT} value={clienteId} disabled={deshabilitado} onChange={e => onCambiar(e.target.value)}>
        <option value="">Elige un cliente</option>
        {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      {clientes.length === 0 && (
        <p role="status" className="mt-1 text-[11px] text-amber-800">
          No hay clientes de venta internacional. <Link to="/clientes" className="font-medium underline underline-offset-2">Crea uno en Clientes</Link>{' '}
          (con tipo de venta «internacional») y vuelve aquí.
        </p>
      )}
    </div>
  );
}

/** Paso 1: packing list de la exportación y cliente internacional (se precarga el que ya tenga el packing list). */
function PasoEleccion({ esNueva, packingLists, detalle, clientes, clienteId, puedeEditar, onElegirPackingList, onCambiarCliente }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {esNueva
        ? <SelectorPackingList packingLists={packingLists} valor={detalle?.id ?? ''} onElegir={onElegirPackingList} />
        : (
          <div>
            <p className={LABEL}>Packing list</p>
            <p className="text-sm font-medium">{detalle?.contenedor}</p>
            {detalle && <Link to={`/packing-list/${detalle.id}`} className="text-[11px] font-medium text-brand-700 underline underline-offset-2">Abrir el packing list</Link>}
          </div>
        )}
      <SelectorCliente clientes={clientes} clienteId={clienteId} deshabilitado={!detalle || !puedeEditar} onCambiar={onCambiarCliente} />
      {!puedeEditar && <p className="text-xs text-text-muted md:col-span-2">No tienes permiso para cambiar el cliente del packing list.</p>}
    </div>
  );
}

export default PasoEleccion;
