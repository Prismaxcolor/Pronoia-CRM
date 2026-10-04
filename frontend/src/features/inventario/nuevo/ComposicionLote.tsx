/** Composición de un lote: qué productos (clasificaciones de compra) lo forman, cuántos kg hay de cada uno ahora y cuántos
 *  se compraron en el periodo elegido. Se muestra dentro de la fila expandida de la tabla de detalle del inventario.
 *  Caché en memoria por lote + fechas + almacén + versión de la tabla para no recargar al reabrir. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import type { ComposicionLote as DatosComposicion } from '@shared/types/inventario-pantalla.js';
import { obtenerComposicionLote } from '../../../services/inventario-pantalla-service';
import { estiloCategoria } from '../../../lib/colores-categoria';
import { formatearKg, formatearNumero } from '../../../lib/formato';
import {
  calcularSinDetalle, claveComposicion, composicionVacia, ordenarYCalcularPct, textoAvisoAproximado, totalizarComposicion,
  type FiltrosComposicion,
} from '../../../lib/inventario-composicion';
import { BarraProgreso, EstadoVacio, InfoTooltip } from '../../../components/ui';

export interface ComposicionLoteProps {
  loteId: string;
  filtros: FiltrosComposicion;
  /** Stock total del lote que muestra la fila. Permite mostrar los kilos sin detalle por producto. */
  kgLote?: number;
  /** Cambia cuando la tabla se recarga: invalida la caché de este lote y vuelve a pedir la composición. */
  version?: number;
}

const AYUDA_PRODUCTO = 'El producto o clasificación de compra que forma parte del lote (por ejemplo teléfonos, central, memoria dorada). El símbolo indica su categoría.';
const AYUDA_KG_ACTUAL = 'Lo que hay hoy en el lote, repartido por producto. Es el material que sigue dentro del lote en este momento.';
const AYUDA_KG_COMPRADO = 'Kilos que se compraron de ese producto dentro del rango de fechas elegido y fueron a este lote. Si cambias las fechas del filtro, esta cifra cambia.';
const AYUDA_PORCENTAJE = 'Qué parte del lote representa el producto: sus kilos de hoy entre el total de kilos de hoy del lote.';

const TEXTO_SIN_DETALLE = 'Kilos que entraron por conteo de toma física sin indicar de qué producto eran; el sistema no puede repartirlos por clasificación.';

/** Caché a nivel de módulo: sobrevive a cerrar y reabrir la fila. */
const CACHE = new Map<string, DatosComposicion>();

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; mensaje: string }
  | { fase: 'listo'; datos: DatosComposicion };

const MENSAJE_ERROR = 'No se pudo cargar la composición de este lote.';

/** El servicio puede devolver el dato directo o { dato } | { error }; se aceptan ambas formas. */
async function cargar(loteId: string, filtros: FiltrosComposicion): Promise<DatosComposicion> {
  const r: unknown = await obtenerComposicionLote(loteId, filtros);
  if (r && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    if (typeof o.error === 'string' && !('items' in o)) throw new Error(o.error);
    if ('dato' in o) return o.dato as DatosComposicion;
  }
  return r as DatosComposicion;
}

function useComposicion(loteId: string, filtros: FiltrosComposicion, version: number) {
  const { desde, hasta, almacenId } = filtros;
  // La versión va en la clave: cuando la tabla se recarga (compra, traslado, embalado) la composición guardada deja de valer.
  const claveCache = `${claveComposicion(loteId, { desde, hasta, almacenId })}|v${version}`;
  const [intento, setIntento] = useState(0);
  const claveCarga = `${claveCache}|i${intento}`;
  const [resultado, setResultado] = useState<{ clave: string; estado: Estado } | null>(null);

  // Un reintento ignora la caché. El estado se deriva: solo se escribe desde las respuestas, nunca de forma síncrona en el efecto.
  const guardado = intento === 0 ? CACHE.get(claveCache) : undefined;

  useEffect(() => {
    if (guardado) return;
    let cancelado = false;
    cargar(loteId, { desde, hasta, almacenId })
      .then(datos => {
        if (cancelado) return;
        CACHE.set(claveCache, datos);
        setResultado({ clave: claveCarga, estado: { fase: 'listo', datos } });
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        setResultado({ clave: claveCarga, estado: { fase: 'error', mensaje: err instanceof Error && err.message ? err.message : MENSAJE_ERROR } });
      });
    return () => { cancelado = true; };
  }, [guardado, claveCache, claveCarga, loteId, desde, hasta, almacenId]);

  const estado: Estado = guardado
    ? { fase: 'listo', datos: guardado }
    : resultado?.clave === claveCarga ? resultado.estado : { fase: 'cargando' };
  const reintentar = useCallback(() => setIntento(n => n + 1), []);
  return { estado, reintentar };
}

function Cabecera({ texto, ayuda, alineada = 'right' }: { texto: string; ayuda: string; alineada?: 'left' | 'right' }) {
  return (
    <th scope="col" className={`px-3 py-2 text-xs font-semibold text-text-secondary ${alineada === 'right' ? 'text-right' : 'text-left'}`}>
      <span className="inline-flex items-center gap-1">
        {texto}
        <InfoTooltip etiqueta={`Qué significa: ${texto}`}>{ayuda}</InfoTooltip>
      </span>
    </th>
  );
}

function Producto({ nombre, categoria }: { nombre: string; categoria: string | null }) {
  const est = estiloCategoria(categoria);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span
        className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[11px] leading-none"
        style={{ backgroundColor: est.fondo, color: est.color }}
        title={`Categoría: ${est.nombre}`}
        role="img"
        aria-label={`Categoría ${est.nombre}`}
      >
        <span aria-hidden="true">{est.simbolo}</span>
      </span>
      <span className="truncate font-medium text-text-primary">{nombre}</span>
    </span>
  );
}

function EsqueletoComposicion() {
  return (
    <div role="status" aria-label="Cargando la composición del lote" className="space-y-2 p-1">
      {[0, 1, 2].map(i => <div key={i} className="h-8 animate-pulse rounded bg-surface-alt" />)}
    </div>
  );
}

function AvisoAproximado({ nota }: { nota: string | null }) {
  return (
    <div role="note" className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p><span className="font-semibold">Cifras aproximadas. </span>{textoAvisoAproximado(nota)}</p>
    </div>
  );
}

function ComposicionLote({ loteId, filtros, kgLote, version = 0 }: ComposicionLoteProps) {
  const { estado, reintentar } = useComposicion(loteId, filtros, version);

  const datos = estado.fase === 'listo' ? estado.datos : null;
  const items = useMemo(() => ordenarYCalcularPct(datos?.items ?? [], kgLote), [datos, kgLote]);
  const totales = useMemo(() => datos?.totales ?? totalizarComposicion(items), [datos, items]);

  const sinDetalle = useMemo(() => calcularSinDetalle(kgLote, totales.kgActual), [kgLote, totales.kgActual]);
  const kgTotalLote = sinDetalle && kgLote !== undefined ? kgLote : totales.kgActual;

  if (estado.fase === 'cargando') return <EsqueletoComposicion />;

  if (estado.fase === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-800">
        <span className="min-w-0 flex-1">{estado.mensaje}</span>
        <button
          type="button" onClick={reintentar}
          className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  }

  if (!datos || composicionVacia(datos.items)) {
    if (sinDetalle) {
      return (
        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p className="font-semibold">Este lote tiene {formatearKg(sinDetalle.kg)}, pero sin detalle por producto.</p>
          <p className="mt-1 text-xs">{TEXTO_SIN_DETALLE}</p>
        </div>
      );
    }
    return <EstadoVacio mensaje="Este lote no tiene material registrado todavía." descripcion="Cuando se compre o se traslade material a este lote, aquí verás qué productos lo forman." />;
  }

  return (
    <section aria-label="Composición del lote" className="text-sm">
      <p className="mb-2 text-xs text-text-secondary">
        Qué estás viendo: los productos que forman este lote, de más a menos kilos.
      </p>
      {datos.aproximado && <AvisoAproximado nota={datos.nota} />}
      {sinDetalle?.esAlto && (
        <div role="note" className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">{formatearNumero(sinDetalle.pct, 1)} % del lote no tiene detalle por producto. </span>
            Los productos de la lista explican solo una parte de los {formatearKg(kgTotalLote)} del lote.
          </p>
        </div>
      )}

      {/* Escritorio y tablet: tabla */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[32rem] border-collapse">
          <thead className="border-b border-border-strong">
            <tr>
              <Cabecera texto="Producto" ayuda={AYUDA_PRODUCTO} alineada="left" />
              <Cabecera texto="Kg en el lote ahora" ayuda={AYUDA_KG_ACTUAL} />
              <Cabecera texto="Kg comprados en el periodo" ayuda={AYUDA_KG_COMPRADO} />
              <Cabecera texto="% del lote" ayuda={AYUDA_PORCENTAJE} />
            </tr>
          </thead>
          <tbody>
            {items.map(i => (
              <tr key={i.productoId} className="border-b border-border">
                <td className="max-w-[16rem] px-3 py-2"><Producto nombre={i.producto} categoria={i.categoria} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{formatearKg(i.kgActual)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatearKg(i.kgCompradoPeriodo)}</td>
                <td className="w-44 px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-20"><BarraProgreso valor={i.pct} etiqueta={`${i.producto}: ${formatearNumero(i.pct, 1)} % del lote`} alto="h-1.5" /></div>
                    <span className="w-14 text-right tabular-nums">{formatearNumero(i.pct, 1)} %</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {sinDetalle && (
              <tr className="border-b border-amber-300 bg-amber-50 text-amber-900">
                <th scope="row" className="px-3 py-2 text-left font-semibold">
                  <span className="inline-flex items-center gap-1">
                    Sin detalle por producto
                    <InfoTooltip etiqueta="Qué significa: Sin detalle por producto">{TEXTO_SIN_DETALLE}</InfoTooltip>
                  </span>
                </th>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatearKg(sinDetalle.kg)}</td>
                <td className="px-3 py-2 text-right tabular-nums">—</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatearNumero(sinDetalle.pct, 1)} %</td>
              </tr>
            )}
            <tr className="bg-surface-alt font-semibold">
              <th scope="row" className="px-3 py-2 text-left">Total del lote</th>
              <td className="px-3 py-2 text-right tabular-nums">{formatearKg(kgTotalLote)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatearKg(totales.kgCompradoPeriodo)}</td>
              <td className="px-3 py-2 text-right tabular-nums">100 %</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Móvil: tarjetas compactas */}
      <ul className="space-y-2 md:hidden">
        {items.map(i => (
          <li key={i.productoId} className="rounded-lg border border-border bg-surface px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <Producto nombre={i.producto} categoria={i.categoria} />
              <span className="shrink-0 text-xs tabular-nums text-text-secondary">{formatearNumero(i.pct, 1)} %</span>
            </div>
            <div className="mt-1.5"><BarraProgreso valor={i.pct} etiqueta={`${i.producto}: ${formatearNumero(i.pct, 1)} % del lote`} alto="h-1.5" /></div>
            <dl className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-text-secondary">En el lote ahora</dt><dd className="font-medium tabular-nums">{formatearKg(i.kgActual)}</dd></div>
              <div><dt className="text-text-secondary">Comprados en el periodo</dt><dd className="font-medium tabular-nums">{formatearKg(i.kgCompradoPeriodo)}</dd></div>
            </dl>
          </li>
        ))}
        {sinDetalle && (
          <li className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-semibold">
                Sin detalle por producto
                <InfoTooltip etiqueta="Qué significa: Sin detalle por producto">{TEXTO_SIN_DETALLE}</InfoTooltip>
              </span>
              <span className="tabular-nums">{formatearNumero(sinDetalle.pct, 1)} %</span>
            </div>
            <p className="mt-1 font-medium tabular-nums">{formatearKg(sinDetalle.kg)}</p>
          </li>
        )}
        <li className="rounded-lg bg-surface-alt px-3 py-2 text-xs font-semibold">
          <p>Total del lote</p>
          <p className="mt-0.5 tabular-nums">{formatearKg(kgTotalLote)} ahora · {formatearKg(totales.kgCompradoPeriodo)} comprados en el periodo</p>
        </li>
      </ul>
    </section>
  );
}

export default ComposicionLote;
