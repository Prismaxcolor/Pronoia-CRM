/** Pestaña "Configuración" de /transformaciones: salidas comunes por material de entrada (editable, igual que siempre) y,
 *  como lectura, los umbrales con los que la pantalla avisa (merma y días de espera). */

import { useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import type { Producto, SalidaComun } from '@shared/types/index.js';
import { guardarSalidasComunes } from '../../services/transformacion-service';
import { useToast } from '../../hooks/use-toast-context';
import SeleccionarMaterialModal from '../pesaje/SeleccionarMaterialModal';
import { Bloque, formatearNumero } from '../../components/ui';
import { DIAS_PENDIENTE_AVISO, DIAS_PENDIENTE_URGENTE } from '../../lib/transformaciones-kpis';
import type { UmbralMerma } from './transformaciones-comun';

function ConfigSalidasComunes({
  productos,
  salidasComunes,
  onSaved,
}: {
  productos: Producto[];
  salidasComunes: SalidaComun[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [productoEntradaId, setProductoEntradaId] = useState('');
  const [seleccionados, setSeleccionados] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [mostrarSelectorMaterial, setMostrarSelectorMaterial] = useState(false);
  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  useEffect(() => {
    if (!productoEntradaId) { setSeleccionados([]); return; }
    const ids = salidasComunes.filter(s => s.productoEntradaId === productoEntradaId).map(s => s.productoSalidaId);
    setSeleccionados(ids);
  }, [productoEntradaId, salidasComunes]);

  const toggle = (id: string) => {
    setSeleccionados(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const guardar = async () => {
    if (!productoEntradaId) return;
    setGuardando(true);
    const result = await guardarSalidasComunes(productoEntradaId, seleccionados);
    setGuardando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito('Configuración guardada.');
    onSaved();
  };

  const nombreEntrada = productos.find(p => p.id === productoEntradaId)?.nombre;
  const productosSalida = productos.filter(p => p.id !== productoEntradaId);

  return (
    <div className="max-w-md space-y-4">
      <div>
        <label className={labelClass}>Material de entrada</label>
        <button
          type="button"
          onClick={() => setMostrarSelectorMaterial(true)}
          className={`${inputClass} flex items-center justify-between gap-2 text-left`}
        >
          <span className={productoEntradaId ? 'text-text-primary truncate' : 'text-text-muted'}>
            {productos.find(p => p.id === productoEntradaId)?.nombre ?? 'Selecciona el material que entra a la transformación'}
          </span>
          <ChevronDown size={14} className="text-text-muted shrink-0" />
        </button>
      </div>

      {productoEntradaId && (
        <>
          <div>
            <label className={labelClass}>Materiales que habitualmente salen de {nombreEntrada}</label>
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {productosSalida.map(p => (
                <label key={p.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-surface-alt cursor-pointer">
                  <input
                    type="checkbox"
                    checked={seleccionados.includes(p.id)}
                    onChange={() => toggle(p.id)}
                    className="rounded border-border accent-brand-600"
                  />
                  <span className="text-sm text-text-primary">{p.nombre}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={guardar}
            disabled={guardando}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : null}
            Guardar configuración
          </button>
        </>
      )}

      {mostrarSelectorMaterial && (
        <SeleccionarMaterialModal
          productos={productos}
          onClose={() => setMostrarSelectorMaterial(false)}
          onSeleccionar={id => { setProductoEntradaId(id); setMostrarSelectorMaterial(false); }}
        />
      )}
    </div>
  );
}

export interface PestanaConfigProps {
  productos: Producto[];
  salidasComunes: SalidaComun[];
  onSaved: () => void;
  umbral: UmbralMerma;
}

function PestanaConfig({ productos, salidasComunes, onSaved, umbral }: PestanaConfigProps) {
  return (
    <div>
      <Bloque titulo="Salidas comunes por material" queEstasViendo="para cada material que entra, qué materiales de salida aparecen sugeridos primero cuando completas una transformación. Solo ahorra tiempo al escoger: no cambia ninguna cifra.">
        <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <ConfigSalidasComunes productos={productos} salidasComunes={salidasComunes} onSaved={onSaved} />
        </div>
      </Bloque>

      <Bloque titulo="Cuándo avisa esta pantalla" queEstasViendo="los límites con los que esta pantalla marca las alertas de merma y de pendientes. Solo lectura: no se cambian desde aquí.">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-4">
            <dt className="text-sm font-medium text-text-secondary">Umbral de merma</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-text-primary">{formatearNumero(umbral.umbralPct, 0)} %</dd>
            <dd className="mt-1 text-xs text-text-secondary">
              Se avisa si la merma de una transformación supera este porcentaje del peso que entró (amarillo; rojo si pasa del doble).
              {umbral.esPorDefecto ? ' Es el valor por defecto: no se pudo leer la configuración del inventario con este usuario.' : ' Lo define un administrador en la configuración del inventario.'}
            </dd>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <dt className="text-sm font-medium text-text-secondary">Merma mínima para avisar</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-text-primary">{formatearNumero(umbral.minimoKg, 0)} kg</dd>
            <dd className="mt-1 text-xs text-text-secondary">Si se perdieron menos kilos que esto no se avisa, aunque el porcentaje sea alto (con pesos pequeños el porcentaje engaña). Es el mismo criterio del inventario.</dd>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <dt className="text-sm font-medium text-text-secondary">Pendientes atrasados</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-text-primary">{DIAS_PENDIENTE_AVISO} y {DIAS_PENDIENTE_URGENTE} días</dd>
            <dd className="mt-1 text-xs text-text-secondary">Una transformación pendiente sale en amarillo cuando lleva más de {DIAS_PENDIENTE_AVISO} días sin completarse y en rojo (urgente) cuando lleva más de {DIAS_PENDIENTE_URGENTE}.</dd>
          </div>
        </dl>
      </Bloque>
    </div>
  );
}

export default PestanaConfig;
