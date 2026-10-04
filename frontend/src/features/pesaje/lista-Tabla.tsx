import { Trash2 } from 'lucide-react';
import TablaDatos from '../../components/ui/TablaDatos';
import Insignia, { InsigniaEstado } from '../../components/ui/Insignia';
import { formatearFecha, formatearNumero } from '../../lib/formato';
import { infoTipoOperacion } from '../../lib/paleta';
import type { ColumnaTabla, OrdenTabla } from '../../lib/tabla-datos';
import type { EstadoDiferencia } from '../../lib/pesaje-kpis';
import type { Traslado, TicketPesaje } from '@shared/types/index.js';
import type { FilaTicket } from './lista-filas';

interface Props {
  filas: readonly FilaTicket[];
  puedeCrear: boolean;
  puedeEliminar: boolean;
  puedeRecepcionarTraslado: boolean;
  ordenInicial?: OrdenTabla;
  onOrdenar: (orden: OrdenTabla) => void;
  onVerDetalle: (id: string) => void;
  onCompletar: (t: TicketPesaje) => void;
  onEliminar: (t: TicketPesaje) => void;
  onRecepcionarTraslado: (t: Traslado) => void;
  /** Mensaje del estado vacío y su acción. */
  vacio: { mensaje: string; descripcion?: string; accion?: { etiqueta: string; to?: string; onClick?: () => void } };
}

const kg2 = (n: number) => formatearNumero(n, 2);
const btnTexto = 'rounded px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
const btnCodigo = 'rounded text-left font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

const ETIQUETA_DIF: Record<EstadoDiferencia, string> = {
  no_aplica: '—',
  cuadrada: 'Cuadrada',
  en_rango: 'Dentro de rango',
  fuera: 'Fuera de rango',
  favorece_proveedor: 'Materiales sobre el global',
};

function CeldaDiferencia({ f }: { f: FilaTicket }) {
  if (f.difKg === null) return <span className="text-text-muted" title="No hay diferencia que medir: el ticket está en bruto, se pesó en báscula externa, está unido a otro ticket o es un traslado">—</span>;
  const mala = f.estadoDif === 'fuera' || f.estadoDif === 'favorece_proveedor';
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="tabular-nums">{kg2(f.difKg)} kg</span>
      {mala
        ? <Insignia tono={f.estadoDif === 'favorece_proveedor' ? 'peligro' : 'aviso'} forma="cuadrada" title={f.estadoDif === 'favorece_proveedor' ? 'Los materiales suman más kg que el peso global: revisa los pesos antes de facturar' : 'La diferencia supera el 0,6 % del peso global (merma o peso sin clasificar)'}>{ETIQUETA_DIF[f.estadoDif]}</Insignia>
        : <span className="text-[11px] text-text-secondary" title={f.estadoDif === 'cuadrada' ? 'El peso global y los materiales coinciden' : 'La diferencia no pasa del 0,6 % del peso global'}>{ETIQUETA_DIF[f.estadoDif]}</span>}
    </span>
  );
}

function CeldaTipo({ tipo, pastilla = false }: { tipo: FilaTicket['tipo']; pastilla?: boolean }) {
  const info = tipo === 'traslado' ? { etiqueta: 'Traslado', tono: 'neutral' as const } : infoTipoOperacion(tipo);
  return pastilla ? <Insignia tono={info.tono}>{info.etiqueta}</Insignia> : <span className="text-text-secondary">{info.etiqueta}</span>;
}

function CeldaEstado({ f }: { f: FilaTicket }) {
  if (f.origen.kind === 'traslado') return <span className="whitespace-nowrap"><InsigniaEstado estado={f.origen.traslado.estado} /></span>;
  return <span className="whitespace-nowrap"><InsigniaEstado estado={f.origen.ticket.estado} /></span>;
}

function CeldaFacturado({ f }: { f: FilaTicket }) {
  if (f.facturado === null) return <span className="text-text-muted" title="No aplica: los traslados no se facturan, los tickets en bruto aún no se pueden facturar y los unidos a otro ticket se facturan junto con el principal">—</span>;
  return <span className="whitespace-nowrap">{f.facturado ? <Insignia tono="exito">Facturado</Insignia> : <Insignia tono="aviso">Sin facturar</Insignia>}</span>;
}

/** Tabla de tickets y traslados con <TablaDatos> del kit: agrupada en "Por recepcionar" y "Completados", ordenable, exportable a
 *  CSV y, en móvil, como tarjetas. Se carga aparte (lazy). */
function ListaTabla({ filas, puedeCrear, puedeEliminar, puedeRecepcionarTraslado, ordenInicial, onOrdenar, onVerDetalle, onCompletar, onEliminar, onRecepcionarTraslado, vacio }: Props) {
  const hayAccion = puedeCrear || puedeEliminar || puedeRecepcionarTraslado;
  // Las acciones van bajo el N° de control (no en columna propia) para que se vean sin desplazar la tabla.

  const botonesAccion = (f: FilaTicket) => {
    if (f.origen.kind === 'traslado') {
      const t = f.origen.traslado;
      return puedeRecepcionarTraslado && t.estado === 'pendiente'
        ? <button type="button" onClick={() => onRecepcionarTraslado(t)} className={btnTexto}>Recepcionar</button>
        : null;
    }
    const t = f.origen.ticket;
    return (
      <>
        {puedeCrear && t.estado === 'bruto' && <button type="button" onClick={() => onCompletar(t)} className={btnTexto}>Completar</button>}
        {puedeEliminar && !t.facturado && (
          <button type="button" onClick={() => onEliminar(t)} aria-label={`Eliminar ${t.codigo}`} title="Eliminar ticket" className="rounded p-1.5 text-text-muted hover:bg-surface-hover hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </>
    );
  };

  const codigoCelda = (f: FilaTicket) => (
    <span className="flex flex-col items-start gap-0.5">
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {f.origen.kind === 'pesaje'
        ? <button type="button" onClick={() => onVerDetalle((f.origen as { ticket: TicketPesaje }).ticket.id)} className={btnCodigo}>{f.codigo}</button>
        : <span className="font-medium text-text-primary">{f.codigo}</span>}
      {f.unidoA && <Insignia forma="cuadrada" title={`El peso global de este ticket se sumó al de ${f.unidoA}. Se completa y se factura junto con ese ticket, no por separado.`}>Unido a {f.unidoA}</Insignia>}
    </span>
    {hayAccion && <span className="-ml-2 flex items-center gap-0.5">{botonesAccion(f)}</span>}
    </span>
  );

  const columnas: ColumnaTabla<FilaTicket>[] = [
    { clave: 'codigo', titulo: 'N° control', valorOrden: f => f.codigo, celda: codigoCelda, claseCelda: 'whitespace-nowrap' },
    { clave: 'fecha', titulo: 'Fecha', valorOrden: f => f.fecha, celda: f => formatearFecha(f.fecha), claseCelda: 'whitespace-nowrap' },
    { clave: 'entidad', titulo: 'Entidad / almacenes', valorOrden: f => f.entidad, ayuda: 'Con quién se hizo la operación: el proveedor en una compra, el cliente en una venta, o el almacén de origen → almacén de destino en un traslado.' },
    { clave: 'materiales', titulo: 'Materiales', valorOrden: f => f.materiales },
    {
      clave: 'peso', titulo: 'Peso (kg)', alinear: 'derecha', decimalesCsv: 2,
      ayuda: 'Kilos de la operación. Ticket en bruto: el peso global del camión. Ticket completo: la suma del peso neto de sus materiales (sin tara). Traslado: los kg enviados, o los recibidos si el destino ya los confirmó.',
      valorOrden: f => f.pesoKg, celda: f => <span className="font-medium text-text-primary">{kg2(f.pesoKg)}</span>,
      total: filas => kg2(filas.reduce((a, f) => a + f.pesoKg, 0)),
    },
    {
      clave: 'diferencia', titulo: 'Diferencia', alinear: 'derecha', decimalesCsv: 3,
      ayuda: 'Peso global menos peso neto de los materiales menos devolución, en kg. Positiva: el camión pesó más de lo clasificado (merma o peso sin clasificar). Negativa: se anotaron más kg de materiales que los de la báscula. «Fuera de rango» significa que la diferencia supera el 0,6 % del peso global. Solo se mide en tickets completos pesados en báscula propia y que no estén unidos a otro.',
      valorOrden: f => f.difKg, celda: f => <CeldaDiferencia f={f} />,
    },
    { clave: 'vehiculo', titulo: 'Vehículo', valorOrden: f => (f.vehiculo === '—' ? null : f.vehiculo), celda: f => f.vehiculo, claseCelda: 'whitespace-nowrap' },
    { clave: 'estado', titulo: 'Estado', valorOrden: f => (f.origen.kind === 'traslado' ? f.origen.traslado.estado : f.origen.ticket.estado), celda: f => <CeldaEstado f={f} /> },
    { clave: 'facturado', titulo: 'Facturado', valorOrden: f => f.facturado, celda: f => <CeldaFacturado f={f} /> },
  ];

  const tarjeta = (f: FilaTicket) => {
    const acciones = botonesAccion(f);
    return (
      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm">
              {f.origen.kind === 'pesaje'
                ? <button type="button" onClick={() => onVerDetalle((f.origen as { ticket: TicketPesaje }).ticket.id)} className={`${btnCodigo} text-base after:absolute after:inset-0`}>{f.codigo}</button>
                : <span className="text-base font-medium text-text-primary">{f.codigo}</span>}
            </p>
            <p className="mt-0.5 text-sm text-text-primary">{f.entidad}</p>
            <p className="text-xs text-text-secondary">{f.materiales}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-bold tabular-nums text-text-primary">{kg2(f.pesoKg)}<span className="ml-1 text-xs font-medium text-text-secondary">kg</span></p>
            <p className="text-xs text-text-secondary">{formatearFecha(f.fecha)}</p>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <CeldaTipo tipo={f.tipo} pastilla />
          <CeldaEstado f={f} />
          {f.facturado !== null && <CeldaFacturado f={f} />}
          {f.unidoA && <Insignia forma="cuadrada">Unido a {f.unidoA}</Insignia>}
        </div>
        {(f.difKg !== null || f.vehiculo !== '—') && (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 text-xs">
            {f.difKg !== null && <div><dt className="text-text-secondary">Diferencia</dt><dd className="font-medium"><CeldaDiferenciaMovil f={f} /></dd></div>}
            {f.vehiculo !== '—' && <div><dt className="text-text-secondary">Vehículo</dt><dd className="font-medium">{f.vehiculo}</dd></div>}
          </dl>
        )}
        {acciones && <div className="relative z-10 mt-2 flex items-center justify-end gap-1 border-t border-border pt-2">{acciones}</div>}
      </div>
    );
  };

  return (
    <TablaDatos<FilaTicket>
      titulo="Tickets de pesaje y traslados"
      columnas={columnas}
      filas={filas}
      claveFila={f => f.clave}
      etiquetaFila={f => f.codigo}
      ordenInicial={ordenInicial}
      onOrdenar={onOrdenar}
      agrupar={{
        clave: f => (f.porRecepcionar ? 'por-recepcionar' : 'completados'),
        titulo: c => (c === 'por-recepcionar' ? 'Por recepcionar (completar)' : 'Completados: por facturar y facturados'),
        ordenGrupos: (a, b) => (a.clave === b.clave ? 0 : a.clave === 'por-recepcionar' ? -1 : 1),
        maxFilasAbiertasPorDefecto: 1000,
      }}
      exportar={{ nombreArchivo: 'tickets-pesaje' }}
      tarjetaMovil={tarjeta}
      anchoMinimo="min-w-[56rem]"
      vacio={vacio}
    />
  );
}

function CeldaDiferenciaMovil({ f }: { f: FilaTicket }) {
  const mala = f.estadoDif === 'fuera' || f.estadoDif === 'favorece_proveedor';
  return <span>{kg2(f.difKg ?? 0)} kg · <span className={mala ? 'font-semibold text-amber-800' : 'text-text-secondary'}>{ETIQUETA_DIF[f.estadoDif]}</span></span>;
}

export default ListaTabla;
