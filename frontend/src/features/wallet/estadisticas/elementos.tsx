import { useCallback, useContext, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import BotonCompartirTarjeta from './BotonCompartirTarjeta';
import { CompartirContext } from './compartir-contexto';
import { textoVariacion } from './estadisticas-informes';

/** Piezas visuales compartidas de Estadísticas (tema claro del sistema por tokens w-*). El color nunca va solo: siempre hay signo y palabras. */

interface PropsTarjeta {
  titulo: string;
  pregunta: string;
  /** Botones propios de la tarjeta (junto al ícono de compartir). */
  acciones?: ReactNode;
  /** Cambia cuando cambia lo que la tarjeta muestra por una opción local (vista, agrupación): invalida la imagen precalculada. */
  claveImagen?: string;
  children: ReactNode;
}

export function Tarjeta({ titulo, pregunta, acciones, claveImagen = '', children }: PropsTarjeta) {
  const id = `est-${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const ref = useRef<HTMLElement>(null);
  const obtenerTarjeta = useCallback(() => ref.current, []);
  const compartir = useContext(CompartirContext);
  return (
    <section ref={ref} aria-labelledby={id} className="rounded-xl border border-w-borde bg-w-tarjeta p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-bold">{titulo}</h2>
          <p className="mt-0.5 text-sm text-w-texto2">{pregunta}</p>
        </div>
        {(acciones || compartir) && (
          <div data-no-imagen className="-mr-1 -mt-1 flex shrink-0 items-center gap-1">
            {acciones}
            {compartir && <BotonCompartirTarjeta key={`${compartir.huella}|${claveImagen}`} obtenerTarjeta={obtenerTarjeta} titulo={titulo} rotuloPeriodo={compartir.rotuloPeriodo} />}
          </div>
        )}
      </div>
      <hr className="my-3 border-w-borde" />
      {children}
    </section>
  );
}

export function Aviso({ children }: { children: ReactNode }) {
  return <p role="note" className="mt-3 rounded-lg border border-w-borde bg-w-grupo px-3 py-2 text-xs text-w-texto2">{children}</p>;
}

export function Vacio({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div role="status" className="py-6 text-center">
      <p className="font-medium">{titulo}</p>
      <p className="mt-1 text-sm text-w-texto2">{detalle}</p>
    </div>
  );
}

export const TEXTO_SIN_PERIODO = 'sin período anterior para comparar';

/** Variación porcentual. `sentido`: en gastos subir es malo (rojo) y bajar es bueno (verde); en ingresos y flujo, al revés.
 *  Las variaciones absurdas (más de 1000 %) se muestran acotadas ("> +1000 %"); el cálculo no cambia. */
/** `sinPeriodoComo` decide qué se ve cuando no hay período anterior: "---" (en tablas), un texto claro o nada. */
export function Variacion({ pct, sentido, sinPeriodo = false, sinPeriodoComo = 'guiones' }: {
  pct: number | null; sentido: 'gasto' | 'ingreso'; sinPeriodo?: boolean; sinPeriodoComo?: 'guiones' | 'texto' | 'nada';
}) {
  if (pct === null && sinPeriodo && sinPeriodoComo === 'nada') return null;
  if (pct === null && sinPeriodo && sinPeriodoComo === 'texto') return <span className="text-w-texto2">{TEXTO_SIN_PERIODO}</span>;
  if (pct === null) {
    const motivo = sinPeriodo ? 'No hay período anterior con datos' : 'Sin base de comparación';
    const detalle = sinPeriodo ? 'No hay período anterior con datos para comparar' : 'Sin base de comparación: el período anterior no tiene monto en este concepto';
    return <span className="text-w-texto2" title={detalle}>---<span className="sr-only"> {motivo.toLowerCase()}</span></span>;
  }
  if (Math.abs(pct) < 0.05) return <span className="tabular-nums text-w-texto2">0 %<span className="sr-only"> sin cambio</span></span>;
  const sube = pct > 0;
  const bueno = sentido === 'gasto' ? !sube : sube;
  const { texto, acotada } = textoVariacion(pct, 1);
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums font-medium ${bueno ? 'text-w-positivo' : 'text-w-negativo'}`}>
      <span aria-hidden="true">{sube ? '▲' : '▼'}</span>
      <span title={acotada ? 'La variación real es todavía mayor; se muestra acotada' : undefined}>{texto}</span>
      <span className="sr-only">{sube ? ' subió' : ' bajó'}{bueno ? ' (favorable)' : ' (desfavorable)'}</span>
    </span>
  );
}

export interface FilaBarra {
  clave: string;
  etiqueta: string;
  /** Texto del valor (ya formateado o enmascarado). */
  valorTxt: string;
  /** Ancho de la barra, 0 a 100. */
  pct: number;
  color: string;
  /** Texto secundario bajo la etiqueta. */
  detalle?: string;
  extra?: ReactNode;
  /** Círculo/ícono decorativo antes de la etiqueta. */
  icono?: ReactNode;
  /** Si existe, toda la fila es un enlace a esa ruta. */
  enlace?: string;
  /** Texto para lectores de pantalla del destino del enlace ("ver registros"). */
  enlaceAria?: string;
}

export function ContenidoBarra({ f }: { f: FilaBarra }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2">{f.icono}<span className="truncate">{f.etiqueta}</span>{f.detalle && <span className="ml-2 text-xs text-w-texto2">{f.detalle}</span>}</span>
        <span className="flex shrink-0 items-baseline gap-2 tabular-nums">{f.extra}<span className="font-medium">{f.valorTxt}</span></span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-w-grupo" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, f.pct))}%`, backgroundColor: f.color }} />
      </div>
    </>
  );
}

/** Barras horizontales como lista de texto: cada fila dice su nombre y su valor, la barra solo refuerza. */
export function ListaBarras({ filas, etiquetaAria }: { filas: readonly FilaBarra[]; etiquetaAria: string }) {
  return (
    <ul aria-label={etiquetaAria} className="space-y-1">
      {filas.map(f => (
        <li key={f.clave}>
          {f.enlace ? (
            <Link to={f.enlace} className="block rounded-lg px-1 py-1.5 hover:bg-w-grupo focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento">
              <ContenidoBarra f={f} />
              <span className="sr-only">. {f.enlaceAria ?? 'Ver registros'}</span>
            </Link>
          ) : <div className="px-1 py-1.5"><ContenidoBarra f={f} /></div>}
        </li>
      ))}
    </ul>
  );
}

/** Tabla solo para lectores de pantalla: el equivalente accesible de una gráfica. */
export function TablaAccesible({ titulo, columnas, filas }: { titulo: string; columnas: readonly string[]; filas: readonly (readonly string[])[] }) {
  return (
    <table className="sr-only" data-no-imagen>
      <caption>{titulo}</caption>
      <thead><tr>{columnas.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
      <tbody>{filas.map((f, i) => <tr key={i}>{f.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
    </table>
  );
}

export interface ItemLeyenda {
  etiqueta: string;
  color: string;
  tipo?: 'barra' | 'linea';
  /** Trazo de la línea (stroke-dasharray): "" continuo, "2 5" punteado, "8 5" guiones. Distingue series sin depender del color. */
  trazo?: string;
}

export function Leyenda({ items }: { items: readonly ItemLeyenda[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-w-texto2">
      {items.map(i => (
        <li key={i.etiqueta} className="flex items-center gap-1.5">
          {i.tipo === 'linea' && i.trazo !== undefined ? (
            <svg aria-hidden="true" width="26" height="6" viewBox="0 0 26 6"><line x1="1" x2="25" y1="3" y2="3" stroke={i.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={i.trazo || undefined} /></svg>
          ) : (
            <span aria-hidden="true" className={i.tipo === 'linea' ? 'h-0.5 w-4' : 'h-2.5 w-2.5 rounded-sm'} style={{ backgroundColor: i.color }} />
          )}
          {i.etiqueta}
        </li>
      ))}
    </ul>
  );
}

/** Dice, con la cantidad, cuántos movimientos quedaron fuera por no tener equivalente en USD. */
export function AvisoSinEquivalente({ cantidad }: { cantidad: number }) {
  if (cantidad === 0) return null;
  return (
    <Aviso>
      {cantidad === 1 ? 'Se excluyó 1 movimiento' : `Se excluyeron ${cantidad} movimientos`} de este período por no tener equivalente en USD (no hay tasa de su fecha); no están en las sumas.
    </Aviso>
  );
}

/** Aviso cuando faltan datos para convertir cuentas en Bs. */
export function AvisoTasa({ omitidas, cargando }: { omitidas: number; cargando: boolean }) {
  if (cargando) return <Aviso>Calculando el equivalente de las cuentas en Bs…</Aviso>;
  if (omitidas === 0) return null;
  return <Aviso>{omitidas === 1 ? '1 cuenta no suma' : `${omitidas} cuentas no suman`} al total: falta la tasa Binance o su moneda no tiene conversión a USD.</Aviso>;
}
