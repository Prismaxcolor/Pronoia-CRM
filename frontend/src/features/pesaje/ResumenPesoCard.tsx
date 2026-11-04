import { Scale } from 'lucide-react';
import type { TipoPesajeBorrador } from '../../hooks/use-pesaje-borrador-context';
import FotoMaterialPicker from './FotoMaterialPicker';
import { colorClaseDiferencia, descripcionDiferencia } from './diferencia-peso';
import { formatearKgPesaje } from './pesaje-nuevo-logica';
import { sumaPesajesGlobales, type PesajeGlobalFila } from './pesaje-global-fila';
import type { FotoMaterial } from './material-fila';

interface Props {
  tipo: TipoPesajeBorrador;
  pesoNetoTotal: number;
  devolucion: string;
  setDevolucion: (valor: string) => void;
  fotosDevolucion: FotoMaterial[];
  onAgregarFotosDevolucion: (files: File[]) => void;
  onQuitarFotoDevolucion: (idx: number) => void;
  sinPesajeGlobal: boolean;
  pesajesGlobales: PesajeGlobalFila[];
  diferencia: number;
}

function DevolucionYDiferencia(p: Props) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 text-sm border-t border-brand-200 pt-2">
        <label htmlFor="devolucion" className="text-brand-800 shrink-0">Devolución (kg)</label>
        <input
          id="devolucion"
          type="number"
          step="0.001"
          min="0"
          value={p.devolucion}
          onChange={e => p.setDevolucion(e.target.value)}
          className="w-28 px-2 py-1 bg-surface border border-brand-200 rounded-md text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400"
          placeholder="0.00"
        />
      </div>
      <p className="text-[11px] text-brand-700/80 -mt-1">
        Kg que el proveedor se lleva de vuelta. Se suma al peso de los materiales para que
        encuadre contra el peso global — no afecta el inventario ni la factura.
      </p>
      <FotoMaterialPicker
        label="Fotos de la devolución"
        fotos={p.fotosDevolucion}
        onAgregar={p.onAgregarFotosDevolucion}
        onQuitar={p.onQuitarFotoDevolucion}
      />
      {!p.sinPesajeGlobal && (
        <div className="flex items-center justify-between text-sm border-t border-brand-200 pt-2">
          <span className="text-brand-800">Diferencia (global vs. neto + devolución)</span>
          <span className={`font-semibold ${colorClaseDiferencia(p.diferencia, sumaPesajesGlobales(p.pesajesGlobales), p.sinPesajeGlobal)}`}>
            {formatearKgPesaje(p.diferencia)} kg
            <span className="ml-1 font-normal text-xs text-brand-700">({descripcionDiferencia(p.diferencia)})</span>
          </span>
        </div>
      )}
    </>
  );
}

/** Resumen del pesaje: suma de materiales y, en compra/venta, devolución y diferencia contra el peso global. */
function ResumenPesoCard(p: Props) {
  return (
    <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-brand-800">
          <Scale size={16} />
          Suma de materiales
        </span>
        <span className={`text-lg font-bold ${p.pesoNetoTotal < 0 ? 'text-red-600' : 'text-brand-700'}`}>
          {formatearKgPesaje(p.pesoNetoTotal)} kg
        </span>
      </div>
      {p.tipo === 'traslado' ? (
        <p className="text-[11px] text-brand-700/80">
          Total que sale del almacén de origen. Queda pendiente hasta que el almacén destino confirme la
          recepción (pestaña Traslados, dentro de Inventario).
        </p>
      ) : (
        <DevolucionYDiferencia {...p} />
      )}
    </div>
  );
}

export default ResumenPesoCard;
