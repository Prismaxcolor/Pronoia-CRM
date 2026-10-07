import { ArrowRight } from 'lucide-react';
import { Insignia, InsigniaEstado, TablaDatos, formatearNumero, type ColumnaTabla } from '../../components/ui';
import {
  TOLERANCIA_DIFERENCIA_KG, diasDesde, diferenciaTraslado, hayDiferencia, resumenMaterialesTraslado,
} from '../../lib/almacenes-kpis';
import type { Traslado } from '@shared/types/index.js';
import { formatearFechaHora } from '../../lib/fecha-negocio';

const kg2 = (n: number) => formatearNumero(n, 2);
const BOTON_FILA = 'rounded px-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

export interface AccionesTraslado {
  puedeCompletar: boolean;
  puedeEditar: boolean;
  onDetalle: (t: Traslado) => void;
  onEditar: (t: Traslado) => void;
  onCompletar: (t: Traslado) => void;
}

/** Botones de una fila/tarjeta de traslado. Mismas condiciones que antes: Editar con permiso o llave; Recepcionar solo pendientes. */
export function BotonesTraslado({ t, a }: { t: Traslado; a: AccionesTraslado }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      <button type="button" onClick={() => a.onDetalle(t)} aria-label={`Ver detalle de ${t.codigo}`} className={`${BOTON_FILA} text-text-secondary hover:text-text-primary`}>Detalle</button>
      {a.puedeEditar && (
        <button type="button" onClick={() => a.onEditar(t)} aria-label={`Editar ${t.codigo}`} className={`${BOTON_FILA} text-text-secondary hover:text-text-primary`}>Editar</button>
      )}
      {a.puedeCompletar && t.estado === 'pendiente' && (
        <button type="button" onClick={() => a.onCompletar(t)} aria-label={`Recepcionar ${t.codigo}`} className={`${BOTON_FILA} text-brand-700 hover:text-brand-800`}>Recepcionar</button>
      )}
    </span>
  );
}

function celdaDiferencia(t: Traslado) {
  const d = diferenciaTraslado(t);
  if (d == null) return <span className="text-text-muted">—</span>;
  if (!hayDiferencia(d)) return <span className="text-text-secondary">Sin diferencia</span>;
  return (
    <Insignia tono="aviso" forma="cuadrada" title="Los kg pesados al llegar no coinciden con los pesados al salir (recibido menos enviado).">
      {d > 0 ? '+' : ''}{kg2(d)} kg · revisar
    </Insignia>
  );
}

function columnasTraslados(a: AccionesTraslado, hoy: Date): ColumnaTabla<Traslado>[] {
  return [
    {
      clave: 'codigo', titulo: 'N° control', valorOrden: t => t.numero,
      celda: t => <span className="whitespace-nowrap font-medium text-text-primary">{t.codigo}</span>,
      valorCsv: t => t.codigo,
    },
    { clave: 'fecha', titulo: 'Enviado el', valorOrden: t => t.createdAt, celda: t => formatearFechaHora(t.createdAt), valorCsv: t => formatearFechaHora(t.createdAt), claseCelda: 'whitespace-nowrap' },
    {
      clave: 'ruta', titulo: 'Origen → destino', valorOrden: t => `${t.nombreAlmacenOrigen ?? ''} ${t.nombreAlmacenDestino ?? ''}`,
      celda: t => (
        <span className="inline-flex flex-wrap items-center gap-1">
          {t.nombreAlmacenOrigen ?? '—'} <ArrowRight size={12} aria-label="hacia" className="text-text-muted" /> {t.nombreAlmacenDestino ?? '—'}
        </span>
      ),
      valorCsv: t => `${t.nombreAlmacenOrigen ?? ''} -> ${t.nombreAlmacenDestino ?? ''}`,
    },
    { clave: 'materiales', titulo: 'Material', valorOrden: t => resumenMaterialesTraslado(t), ocultaEnMovil: false },
    {
      clave: 'enviado', titulo: 'Enviado (kg)', alinear: 'derecha', valorOrden: t => t.pesoNetoEnviado, celda: t => kg2(t.pesoNetoEnviado),
      decimalesCsv: 2, total: ts => kg2(ts.reduce((s, t) => s + t.pesoNetoEnviado, 0)),
    },
    {
      clave: 'recibido', titulo: 'Recibido (kg)', alinear: 'derecha', valorOrden: t => (t.estado === 'completo' ? t.pesoNetoRecibido : null),
      celda: t => (t.estado === 'completo' ? kg2(t.pesoNetoRecibido ?? 0) : '—'), decimalesCsv: 2,
      total: ts => kg2(ts.filter(t => t.estado === 'completo').reduce((s, x) => s + (x.pesoNetoRecibido ?? 0), 0)),
      ayuda: 'Kg que se pesaron al llegar al almacén destino. Un traslado pendiente todavía no tiene este dato.',
    },
    {
      clave: 'diferencia', titulo: 'Diferencia (kg)', alinear: 'derecha', valorOrden: t => diferenciaTraslado(t), celda: celdaDiferencia,
      valorCsv: t => diferenciaTraslado(t), decimalesCsv: 2,
      total: ts => {
        const s = ts.reduce((acc, t) => acc + (diferenciaTraslado(t) ?? 0), 0);
        return Math.abs(s) > TOLERANCIA_DIFERENCIA_KG ? `${s > 0 ? '+' : ''}${kg2(s)}` : '0,00';
      },
      ayuda: 'Kg recibidos menos kg enviados. Negativo: llegó menos de lo que salió; positivo: llegó más. Solo se calcula cuando el traslado ya fue recibido; diferencias de 0,01 kg o menos se tratan como redondeo de la báscula.',
    },
    {
      clave: 'estado', titulo: 'Estado', valorOrden: t => t.estado,
      celda: t => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <InsigniaEstado estado={t.estado} />
          {t.estado === 'pendiente' && <span className="text-xs text-text-muted">hace {formatearNumero(diasDesde(t.createdAt, hoy), 0)} d</span>}
        </span>
      ),
      valorCsv: t => (t.estado === 'completo' ? 'Completo' : 'Pendiente'),
    },
    { clave: 'acciones', titulo: 'Acciones', alinear: 'derecha', celda: t => <BotonesTraslado t={t} a={a} />, valorCsv: false },
  ];
}

interface Props {
  traslados: readonly Traslado[];
  acciones: AccionesTraslado;
  hoy: Date;
  hayFiltros: boolean;
  onLimpiar: () => void;
}

/** Historial de traslados: ordenable, con totales y exportación a CSV; en móvil, tarjetas apiladas. */
function TrasladosTabla({ traslados, acciones, hoy, hayFiltros, onLimpiar }: Props) {
  return (
    <TablaDatos
      titulo="Historial de traslados entre almacenes"
      columnas={columnasTraslados(acciones, hoy)}
      filas={traslados}
      claveFila={t => t.id}
      ordenInicial={{ columna: 'codigo', sentido: 'desc' }}
      totales={{ etiqueta: `Totales (${formatearNumero(traslados.length, 0)} traslados)` }}
      exportar={{ nombreArchivo: 'traslados' }}
      paginacion={{ tamano: 25 }}
      etiquetaFila={t => t.codigo}
      vacio={hayFiltros
        ? { mensaje: 'Ningún traslado coincide con estos filtros', descripcion: 'Prueba con otro periodo (por ejemplo «Todo») o quita algún filtro.', accion: { etiqueta: 'Quitar filtros', onClick: onLimpiar } }
        : { mensaje: 'Todavía no hay traslados', descripcion: 'Los traslados se crean desde Pesaje, con el tipo «Traslado», y quedan pendientes hasta que el almacén destino confirma la recepción.', accion: { etiqueta: 'Ir a Pesaje', to: '/pesaje' } }}
    />
  );
}

export default TrasladosTabla;
