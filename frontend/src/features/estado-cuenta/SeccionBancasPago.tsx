import { Plus } from 'lucide-react';
import type { Banca } from '@shared/types/index.js';
import type { EstadoTasasUsd } from '../cochinito/equivalente-usd';
import type { EstadoComision } from '../cochinito/comision-formulario';
import FilaBancaPago, { type LineaBanca } from './FilaBancaPago';
import { fmt } from './pago-cobro-formato';

export interface AccionesLineasBanca {
  agregar: () => void;
  quitar: (id: number) => void;
  setBanca: (id: number, bancaId: string) => void;
  setMonto: (id: number, montoUsd: string) => void;
  setReferencia: (id: number, referencia: string) => void;
  setCampos: (id: number, campos: Partial<LineaBanca>) => void;
}

interface Props {
  etiqueta: string;
  esProveedor: boolean;
  bancas: Banca[];
  /** Líneas tal como se ven (con el monto auto-sincronizado cuando hay una sola). */
  lineas: LineaBanca[];
  tasaBcv: number | null;
  tasasUsd: EstadoTasasUsd;
  comisionEstado: EstadoComision;
  tasaDeLinea: (linea: LineaBanca) => number | null;
  acciones: AccionesLineasBanca;
  onReintentarComision: () => void;
  sumaUsd: number;
  totalUsd: number;
  cuadra: boolean;
}

/** Bancas de origen (pago) o destino (cobro): una línea por cuenta, con su monto, referencia y tasa. */
function SeccionBancasPago(p: Props) {
  const usadas = new Set(p.lineas.map(l => l.bancaId).filter(Boolean));
  const hayCuentaEnBs = p.lineas.some(l => p.bancas.find(b => b.id === l.bancaId)?.moneda === 'VES');
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-text-secondary">{p.etiqueta} *</label>
        {p.lineas.length < p.bancas.length && (
          <button type="button" onClick={p.acciones.agregar} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
            <Plus size={13} /> Agregar banca
          </button>
        )}
      </div>

      <div className="space-y-2">
        {p.lineas.map(linea => (
          <FilaBancaPago
            key={linea.id}
            linea={linea}
            banca={p.bancas.find(b => b.id === linea.bancaId)}
            bancasElegibles={p.bancas.filter(b => b.id === linea.bancaId || !usadas.has(b.id))}
            esProveedor={p.esProveedor}
            puedeQuitar={p.lineas.length > 1}
            tasaBs={p.tasaDeLinea(linea)}
            tasasUsd={p.tasasUsd}
            comisionEstado={p.comisionEstado}
            onBanca={id => p.acciones.setBanca(linea.id, id)}
            onMonto={monto => p.acciones.setMonto(linea.id, monto)}
            onReferencia={ref => p.acciones.setReferencia(linea.id, ref)}
            onCampos={campos => p.acciones.setCampos(linea.id, campos)}
            onQuitar={() => p.acciones.quitar(linea.id)}
            onReintentarComision={p.onReintentarComision}
          />
        ))}
      </div>

      {!p.esProveedor && !p.tasaBcv && hayCuentaEnBs && (
        <p className="text-xs text-red-600 mt-1">No se pudo obtener la tasa de cambio.</p>
      )}

      <p className={`text-xs mt-2 ${p.cuadra ? 'text-green-600' : 'text-red-600'}`}>
        Suma de bancas: ${fmt(p.sumaUsd)} de ${fmt(p.totalUsd)}
        {!p.cuadra && ` (faltan $${fmt(p.totalUsd - p.sumaUsd)})`}
      </p>
    </div>
  );
}

export default SeccionBancasPago;
