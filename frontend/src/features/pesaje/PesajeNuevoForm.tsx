import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { TicketPesaje } from '@shared/types/index.js';
import type { PesajeBorradorContextType } from '../../hooks/use-pesaje-borrador-context';
import AvisoBorrador from '../../components/AvisoBorrador';
import VehiculoSelector from '../../components/VehiculoSelector';
import AlmacenDelPesaje from './AlmacenDelPesaje';
import LotesTrasladarSeccion from './LotesTrasladarSeccion';
import MaterialesSeccion from './MaterialesSeccion';
import PesajeGlobalSeccion from './PesajeGlobalSeccion';
import { EncabezadoPesaje, ToggleTipoOperacion } from './PesajeTipoYEntidad';
import ResumenPesoCard from './ResumenPesoCard';
import TicketsBrutoProveedor from './TicketsBrutoProveedor';
import { INPUT_CLASS, LABEL_CLASS } from './pesaje-clases';
import { faltantesParaAgregar, lotesConStockEnAlmacen, ticketsBrutoDeEntidad, type EntidadPesaje } from './pesaje-nuevo-logica';
import type { usePesajeDatos } from './use-pesaje-datos';
import type { usePesajeFilas } from './use-pesaje-filas';
import type { usePesajeGuardado } from './use-pesaje-guardado';
import type { SelectoresPesaje } from './use-pesaje-selectores';

interface Props {
  datos: ReturnType<typeof usePesajeDatos>;
  ctx: PesajeBorradorContextType;
  filas: ReturnType<typeof usePesajeFilas>;
  sel: SelectoresPesaje;
  guardado: ReturnType<typeof usePesajeGuardado>;
  entidades: EntidadPesaje[];
  labelEntidad: string;
  sinPesajeGlobal: boolean;
  pesoNetoTotal: number;
  diferencia: number;
  onContinuarTicket: (ticket: TicketPesaje) => void;
}

/** Formulario "Nuevo pesaje": compra, venta o traslado entre almacenes. */
function PesajeNuevoForm(p: Props) {
  const { datos, ctx, filas, sel, guardado } = p;
  const { tipo, entidadId, almacenOrigenId, almacenDestinoId, fecha, pesajesGlobales, pesajeExterior, devolucion, fotosDevolucion, materiales, observaciones, vehiculo, loteFilas } = ctx.borrador;
  const almacenPredeterminado = datos.almacenes.find(a => a.esPredeterminado);

  const faltaParaAgregar = useMemo(() => faltantesParaAgregar(materiales, datos.productos), [materiales, datos.productos]);
  const ticketsBrutoProveedor = useMemo(
    () => (tipo === 'compra' ? ticketsBrutoDeEntidad(datos.tickets, entidadId) : []),
    [tipo, datos.tickets, entidadId],
  );
  // Un lote puede tener kilos repartidos en varios almacenes — se muestran acá los que tienen
  // stock en el almacén de origen elegido (no bloquea seleccionar otro: ver stockPorAlmacen en shared/types/lote.ts).
  const lotesEnOrigen = useMemo(() => lotesConStockEnAlmacen(datos.lotes, almacenOrigenId), [datos.lotes, almacenOrigenId]);

  return (
    <form onSubmit={guardado.handleSubmit} className="bg-surface rounded-xl border border-border p-5 space-y-4 h-fit">
      <AvisoBorrador formulario="pesaje" aviso={ctx.avisoRestauracion} onDescartar={ctx.descartarBorradorRestaurado} onCerrar={ctx.cerrarAvisoRestauracion} />
      {ctx.avisoSaneo && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{ctx.avisoSaneo}</p>}
      <ToggleTipoOperacion tipo={tipo} setTipo={ctx.setTipo} setEntidadId={ctx.setEntidadId} setPesajeExterior={ctx.setPesajeExterior} />

      <EncabezadoPesaje
        tipo={tipo} almacenes={datos.almacenes} almacenOrigenId={almacenOrigenId} almacenDestinoId={almacenDestinoId}
        entidades={p.entidades} entidadId={entidadId} labelEntidad={p.labelEntidad} fecha={fecha} setFecha={ctx.setFecha}
        onElegirAlmacenOrigen={sel.abrirAlmacenOrigen} onElegirAlmacenDestino={sel.abrirAlmacenDestino} onElegirEntidad={sel.abrirEntidad}
      />

      {tipo === 'compra' && <TicketsBrutoProveedor tickets={ticketsBrutoProveedor} onContinuar={p.onContinuarTicket} />}

      {tipo !== 'traslado' && (
        <AlmacenDelPesaje tipo={tipo} almacenes={datos.almacenes} almacenPredeterminado={almacenPredeterminado} almacenOrigenId={almacenOrigenId} setAlmacenOrigenId={ctx.setAlmacenOrigenId} />
      )}

      {tipo !== 'traslado' && (
        <PesajeGlobalSeccion
          tipo={tipo} pesajeExterior={pesajeExterior} setPesajeExterior={ctx.setPesajeExterior} sinPesajeGlobal={p.sinPesajeGlobal}
          pesajesGlobales={pesajesGlobales} onAgregar={filas.agregarPesajeGlobal} onQuitar={filas.quitarPesajeGlobal}
          onCampo={filas.setPesajeGlobalCampo} onAgregarFotos={filas.agregarFotosPesajeGlobal} onQuitarFoto={filas.quitarFotoPesajeGlobal}
        />
      )}

      <MaterialesSeccion
        materiales={materiales} faltaParaAgregar={faltaParaAgregar} onAgregarMaterial={filas.agregarMaterial}
        tipo={tipo} productos={datos.productos} lotes={datos.lotes} taras={datos.taras}
        stockOrigen={datos.stockOrigen} stockGlobalDisponible={datos.stockGlobalDisponible}
        onActivar={sel.activarFila} onQuitar={filas.quitarMaterial} onCampo={filas.setFila}
        onTarasExtra={(uid, extras) => ctx.setMateriales(prev => prev.map(x => (x.uid === uid ? { ...x, tarasExtra: extras } : x)))}
        onElegirMaterial={sel.abrirMaterial} onElegirLote={sel.abrirLote} onElegirTara={sel.abrirTara}
        onAgregarFotos={filas.agregarFotosFila} onQuitarFoto={filas.quitarFotoFila}
      />

      {tipo === 'traslado' && almacenOrigenId && (
        <LotesTrasladarSeccion
          loteFilas={loteFilas} lotes={datos.lotes} lotesEnOrigen={lotesEnOrigen} almacenOrigenId={almacenOrigenId}
          onAgregar={filas.agregarLoteFila} onQuitar={filas.quitarLoteFila} onCampo={filas.setLoteFilaCampo}
          onAgregarFotos={filas.agregarFotosLoteFila} onQuitarFoto={filas.quitarFotoLoteFila}
        />
      )}

      <ResumenPesoCard
        tipo={tipo} pesoNetoTotal={p.pesoNetoTotal} devolucion={devolucion} setDevolucion={ctx.setDevolucion}
        fotosDevolucion={fotosDevolucion} onAgregarFotosDevolucion={filas.agregarFotosDevolucion} onQuitarFotoDevolucion={filas.quitarFotoDevolucion}
        sinPesajeGlobal={p.sinPesajeGlobal} pesajesGlobales={pesajesGlobales} diferencia={p.diferencia}
      />

      <VehiculoSelector value={vehiculo} onChange={ctx.setVehiculo} vehiculos={datos.vehiculos} inputClass={INPUT_CLASS} labelClass={LABEL_CLASS} />

      <div>
        <label className={LABEL_CLASS}>Observaciones</label>
        <textarea value={observaciones} onChange={e => ctx.setObservaciones(e.target.value)} className={`${INPUT_CLASS} resize-none`} rows={2} placeholder="Notas del pesaje" />
      </div>

      {guardado.error && <p className="text-red-500 text-sm">{guardado.error}</p>}

      <button type="submit" disabled={guardado.guardando} className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
        {guardado.guardando
          ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
          : tipo === 'traslado' ? 'Generar traslado' : 'Generar ticket de pesaje'}
      </button>

      {tipo === 'compra' && (
        <button
          type="button"
          disabled={guardado.guardando}
          onClick={() => void guardado.guardar('bruto')}
          className="w-full py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          Guardar pesaje global, completar después
        </button>
      )}
    </form>
  );
}

export default PesajeNuevoForm;
