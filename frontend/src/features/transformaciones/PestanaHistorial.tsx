/** Pestaña "Historial" de /transformaciones: transformaciones completadas con sus indicadores (kg procesados, merma,
 *  rendimiento, cantidad), alertas de merma sobre el umbral, gráficas (carga diferida) y la tabla exportable a CSV.
 *  Los indicadores salen de la lista ya cargada (merma = entrada - salidas, igual que el backend); el periodo anterior
 *  tiene la misma duración. Sin completadas en el periodo anterior se dice "sin historial comparable". */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import type { Transformacion } from '@shared/types/index.js';
import {
  Bloque, FiltrosBarra, GrillaKpis, Insignia, ListaAlertas, SkeletonBloque, SkeletonKpis, SkeletonTabla, TablaDatos, TarjetaKpi,
  formatearFecha, formatearNumero, formatearPct, type AlertaDatos, type ColumnaTabla,
} from '../../components/ui';
import { compararConPeriodoAnterior, type ComparacionPeriodo } from '../../lib/comparacion';
import type { ValoresFiltros } from '../../lib/filtros-url';
import { etiquetaSalida } from '../../lib/salida-mixta';
import {
  alertasMerma, compararPeriodos, filtrarTransformaciones, mermaTransformacion, rendimientoPct, severidadMerma, type MermaTransformacion,
} from '../../lib/transformaciones-kpis';
import {
  OPCIONES_FILTRO_CATEGORIA, coincideBusqueda, etiquetaCategoria, nombreEntrada, rangoEfectivo, type UmbralMerma, kgFino } from './transformaciones-comun';

const GraficasMerma = lazy(() => import('./GraficasMerma'));

/** Espera antes de montar las gráficas, para que los indicadores pinten primero. */
const RETARDO_GRAFICAS_MS = 150;
const FILAS_POR_PAGINA = 20;

export interface PestanaHistorialProps {
  /** null = todavía cargando. */
  transformaciones: Transformacion[] | null;
  filtros: ValoresFiltros;
  onCambiarFiltros: (cambios: ValoresFiltros) => void;
  onLimpiarFiltros: () => void;
  umbral: UmbralMerma;
  onIrAPendientes: () => void;
}

interface FilaHistorial { t: Transformacion; m: MermaTransformacion }

/** Volumen y cantidad no son "buenos" ni "malos": la comparación sale en gris. */
const comoNeutra = (c: ComparacionPeriodo | null): ComparacionPeriodo | null => (c ? { ...c, tono: 'neutro' } : null);
const deltaPp = (d: number) => `${formatearNumero(d, 2)} pp`;

function textoSalidas(t: Transformacion): string {
  return t.salidas.map(s => `${etiquetaSalida(s)}: ${kgFino(s.pesoNeto)}`).join(' · ');
}

function ChipsSalidas({ t, max }: { t: Transformacion; max: number }) {
  if (t.salidas.length === 0) return <span className="text-text-muted">—</span>;
  const visibles = t.salidas.slice(0, max);
  return (
    <span className="flex flex-wrap gap-1.5">
      {visibles.map(s => (
        <span key={s.id} className="rounded-full border border-border bg-surface-alt px-2 py-0.5 text-xs text-text-secondary">
          {etiquetaSalida(s)}: {kgFino(s.pesoNeto)}
        </span>
      ))}
      {t.salidas.length > max && <span className="text-xs text-text-secondary">+{t.salidas.length - max} más</span>}
    </span>
  );
}

function CeldaMermaPct({ f, umbral }: { f: FilaHistorial; umbral: UmbralMerma }) {
  const sev = f.m.kgMerma >= umbral.minimoKg ? severidadMerma(f.m.pctMerma, umbral.umbralPct) : null;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      {sev && <Insignia forma="cuadrada" tono={sev === 'roja' ? 'peligro' : 'aviso'} title={`La merma pasa de ${formatearNumero(umbral.umbralPct, 0)} % del peso que entró${sev === 'roja' ? ` (más del doble: ${formatearNumero(umbral.umbralPct * 2, 0)} %)` : ''} y es de al menos ${formatearNumero(umbral.minimoKg, 0)} kg.`}>Sobre umbral</Insignia>}
      {formatearPct(f.m.pctMerma, 2)}
    </span>
  );
}

function PestanaHistorial({ transformaciones, filtros, onCambiarFiltros, onLimpiarFiltros, umbral, onIrAPendientes }: PestanaHistorialProps) {
  const categoria = typeof filtros.categoria === 'string' ? filtros.categoria : undefined;
  const q = typeof filtros.q === 'string' ? filtros.q : undefined;
  const desde = typeof filtros.desde === 'string' ? filtros.desde : undefined;
  const hasta = typeof filtros.hasta === 'string' ? filtros.hasta : undefined;
  const rango = useMemo(() => rangoEfectivo(desde, hasta), [desde, hasta]);

  const [mostrarGraficas, setMostrarGraficas] = useState(false);
  const listo = transformaciones !== null;
  useEffect(() => {
    if (!listo) return;
    const t = setTimeout(() => setMostrarGraficas(true), RETARDO_GRAFICAS_MS);
    return () => clearTimeout(t);
  }, [listo]);

  const datos = useMemo(() => {
    if (!transformaciones) return null;
    const cmp = compararPeriodos(transformaciones, rango, categoria);
    const completas = filtrarTransformaciones(transformaciones, { estado: 'completa', categoria, ...rango }) as Transformacion[];
    const filas: FilaHistorial[] = filtrarTransformaciones(completas, { coincide: t => coincideBusqueda(t as Transformacion, q) })
      .map(t => ({ t: t as Transformacion, m: mermaTransformacion(t) }));
    const alertas = alertasMerma(completas, umbral.umbralPct, umbral.minimoKg);
    return { cmp, completas, filas, alertas, porId: new Map(completas.map(t => [t.id, t])) };
  }, [transformaciones, rango, categoria, q, umbral.umbralPct, umbral.minimoKg]);

  const alertasUi: AlertaDatos[] = useMemo(() => (datos?.alertas ?? []).map(a => {
    const t = datos?.porId.get(a.transformacionId);
    return {
      id: a.id,
      severidad: a.severidad,
      texto: `${t?.codigo ?? 'Transformación'} (${formatearFecha(t?.fecha)}): merma de ${formatearPct(a.pctMerma, 2)} (${kgFino(a.kgMerma)} de ${kgFino(t?.pesoNeto ?? 0)}).`,
      detalle: `El umbral es ${formatearNumero(umbral.umbralPct, 0)} %${a.severidad === 'roja' ? ' y esta merma lo dobla' : ''}. Solo se avisa si la merma es de al menos ${formatearNumero(umbral.minimoKg, 0)} kg.`,
      enlace: { to: `/transformaciones/${a.transformacionId}`, etiqueta: 'Ver transformación' },
    };
  }), [datos, umbral.umbralPct, umbral.minimoKg]);

  const columnas: Array<ColumnaTabla<FilaHistorial>> = useMemo(() => [
    {
      clave: 'codigo', titulo: 'Código', valorOrden: f => f.t.codigo ?? '',
      celda: f => <Link to={`/transformaciones/${f.t.id}`} className="font-medium text-text-primary hover:text-brand-700 hover:underline">{f.t.codigo ?? '—'}</Link>,
    },
    { clave: 'fecha', titulo: 'Fecha', valorOrden: f => f.t.fecha, celda: f => formatearFecha(f.t.fecha), valorCsv: f => f.t.fecha },
    { clave: 'categoria', titulo: 'Categoría', valorOrden: f => etiquetaCategoria(f.t.categoria), ocultaEnMovil: true },
    { clave: 'material', titulo: 'Material de entrada', valorOrden: f => nombreEntrada(f.t) },
    { clave: 'entrada', titulo: 'Entrada (kg)', alinear: 'derecha', valorOrden: f => f.m.kgEntrada, celda: f => formatearNumero(f.m.kgEntrada, 2), decimalesCsv: 3, total: filas => formatearNumero(filas.reduce((a, f) => a + f.m.kgEntrada, 0), 2) },
    { clave: 'salida', titulo: 'Salidas (kg)', alinear: 'derecha', valorOrden: f => f.m.kgSalida, celda: f => formatearNumero(f.m.kgSalida, 2), decimalesCsv: 3, total: filas => formatearNumero(filas.reduce((a, f) => a + f.m.kgSalida, 0), 2) },
    { clave: 'merma', titulo: 'Merma (kg)', alinear: 'derecha', valorOrden: f => f.m.kgMerma, celda: f => formatearNumero(f.m.kgMerma, 2), decimalesCsv: 3, total: filas => formatearNumero(filas.reduce((a, f) => a + f.m.kgMerma, 0), 2) },
    {
      clave: 'pct', titulo: 'Merma %', alinear: 'derecha', valorOrden: f => f.m.pctMerma, valorCsv: f => f.m.pctMerma, decimalesCsv: 2,
      ayuda: `Qué porcentaje del peso que entró se perdió (merma ÷ entrada). "Sobre umbral" aparece cuando pasa de ${formatearNumero(umbral.umbralPct, 0)} % y la merma es de al menos ${formatearNumero(umbral.minimoKg, 0)} kg; sale en rojo si pasa del doble.`,
      celda: f => <CeldaMermaPct f={f} umbral={umbral} />,
      total: filas => {
        const e = filas.reduce((a, f) => a + f.m.kgEntrada, 0);
        const m = filas.reduce((a, f) => a + f.m.kgMerma, 0);
        return e > 0 ? formatearPct((m / e) * 100, 2) : '—';
      },
    },
    { clave: 'salidasTexto', titulo: 'Salidas', ocultaEnMovil: true, valorOrden: f => f.t.salidas.length, celda: f => <ChipsSalidas t={f.t} max={3} />, valorCsv: f => textoSalidas(f.t) },
  ], [umbral]);

  const hayFiltros = Boolean(categoria || q || desde);
  const { actual, anterior } = datos?.cmp ?? {};
  const sinCompletadas = !actual || actual.transformaciones === 0;
  const sobreUmbral = Boolean(actual && actual.kgMerma >= umbral.minimoKg && actual.pctMerma > umbral.umbralPct);

  return (
    <div>
      <FiltrosBarra
        rango={{ desde, hasta, onCambiar: r => onCambiarFiltros(r) }}
        selectores={[{ id: 'hist-categoria', etiqueta: 'Categoría', valor: categoria, opciones: OPCIONES_FILTRO_CATEGORIA, onCambiar: v => onCambiarFiltros({ categoria: v }), textoTodas: 'Todas' }]}
        buscador={{ id: 'hist-q', valor: q, onCambiar: v => onCambiarFiltros({ q: v }), placeholder: 'Código o material…' }}
        onLimpiar={onLimpiarFiltros}
      />

      <section aria-label="Indicadores del historial">
        {!datos || !actual ? <SkeletonKpis /> : (
          <GrillaKpis>
            <TarjetaKpi
              titulo="Kg procesados"
              ayuda="Kilos (kg) netos que entraron a procesarse: suma del peso de entrada de las transformaciones completadas cuya fecha cae en el periodo elegido. Las pendientes por completar no cuentan. Se compara con el periodo anterior de igual duración; si ese no tuvo transformaciones completadas, la comparación sale como «—» (sin historial comparable)."
              valor={formatearNumero(actual.kgEntrada, 0)}
              unidad="kg"
              subtitulo={`${formatearNumero(actual.transformaciones, 0)} ${actual.transformaciones === 1 ? 'transformación completada' : 'transformaciones completadas'}`}
              estado={sinCompletadas ? 'vacio' : 'listo'}
              mensajeVacio="Sin transformaciones completadas en este periodo"
              comparacion={comoNeutra(anterior ? compararConPeriodoAnterior(actual.kgEntrada, anterior.kgEntrada, 'sube') : null)}
              formatoDelta={d => `${formatearNumero(d, 0)} kg`}
            />
            <TarjetaKpi
              titulo="Merma"
              ayuda={`Qué porcentaje del peso que entró se perdió: (kg que entraron − kg que salieron) ÷ kg que entraron, con los totales del periodo. Por ejemplo: entran 100 kg y salen 97 kg, la merma es 3 kg, o sea 3 %. Se pinta en rojo solo si pasa del umbral de ${formatearNumero(umbral.umbralPct, 0)} % y la merma es de al menos ${formatearNumero(umbral.minimoKg, 0)} kg. El cambio frente al periodo anterior va en puntos porcentuales (pp): de 6 % a 8 % son 2 pp.${umbral.esPorDefecto ? ' (Umbral por defecto: no se pudo leer la configuración del inventario.)' : ''}`}
              valor={formatearNumero(actual.pctMerma, 2)}
              unidad="%"
              subtitulo={`${kgFino(actual.kgMerma)} de merma · umbral de aviso ${formatearNumero(umbral.umbralPct, 0)} %`}
              tonoValor={sobreUmbral ? 'peligro' : 'normal'}
              estado={sinCompletadas ? 'vacio' : 'listo'}
              mensajeVacio="Sin transformaciones completadas en este periodo"
              comparacion={anterior ? compararConPeriodoAnterior(actual.pctMerma, anterior.pctMerma, 'baja') : null}
              formatoDelta={deltaPp}
            />
            <TarjetaKpi
              titulo="Rendimiento"
              ayuda="Qué porcentaje del peso que entró se convirtió en producto: 100 % menos el % de merma. Por ejemplo: si de 100 kg que entran salen 99,3 kg de producto, el rendimiento es 99,3 %. Que suba es favorable."
              valor={formatearNumero(rendimientoPct(actual.pctMerma), 2)}
              unidad="%"
              subtitulo="100 % − merma · producto obtenido sobre lo que entró"
              estado={sinCompletadas ? 'vacio' : 'listo'}
              mensajeVacio="Sin transformaciones completadas en este periodo"
              comparacion={anterior ? compararConPeriodoAnterior(rendimientoPct(actual.pctMerma), rendimientoPct(anterior.pctMerma), 'sube') : null}
              formatoDelta={deltaPp}
            />
            <TarjetaKpi
              titulo="Completadas"
              ayuda="Cuántas transformaciones terminadas (con sus salidas ya registradas) tienen fecha dentro del periodo elegido. Se compara con el periodo anterior de igual duración."
              valor={formatearNumero(actual.transformaciones, 0)}
              unidad={actual.transformaciones === 1 ? 'transformación' : 'transformaciones'}
              subtitulo={`Del ${formatearFecha(rango.desde)} al ${formatearFecha(rango.hasta)}`}
              comparacion={comoNeutra(anterior ? compararConPeriodoAnterior(actual.transformaciones, anterior.transformaciones, 'sube') : null)}
              formatoDelta={d => formatearNumero(d, 0)}
            />
          </GrillaKpis>
        )}
      </section>

      <Bloque titulo="Alertas de merma" queEstasViendo={`transformaciones completadas del periodo en las que se perdió más de ${formatearNumero(umbral.umbralPct, 0)} % del peso que entró (amarillo; rojo si pasa del doble, ${formatearNumero(umbral.umbralPct * 2, 0)} %). Solo se avisa si la merma es de al menos ${formatearNumero(umbral.minimoKg, 0)} kg, para no alarmar por pesos pequeños.`}>
        {!datos ? null : (
          <ListaAlertas
            alertas={alertasUi}
            vacio={(
              <div className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
                <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-brand-900">Todo en orden: ninguna merma pasa del umbral</p>
                  <p className="mt-1 text-xs text-text-secondary">El umbral es {formatearNumero(umbral.umbralPct, 0)} %{umbral.esPorDefecto ? ' (valor por defecto)' : ''}; solo se avisa si la merma es de al menos {formatearNumero(umbral.minimoKg, 0)} kg.</p>
                </div>
              </div>
            )}
          />
        )}
      </Bloque>

      {datos && mostrarGraficas ? (
        <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráficas" />}>
          <GraficasMerma completas={datos.completas} rango={rango} categoria={categoria} umbralPct={umbral.umbralPct} minimoKg={umbral.minimoKg} onIrAPendientes={onIrAPendientes} />
        </Suspense>
      ) : (
        <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráficas" />
      )}

      <Bloque
        titulo="Transformaciones completadas"
        queEstasViendo="cada transformación completada del periodo con los kg que entraron, los que salieron y su merma (en kg y en %). La fila Total suma las columnas; su % usa los kg totales. Pulsa el código para ver el detalle completo."
        acciones={<Link to="/transformaciones/merma" className="text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Ver reporte de merma →</Link>}
      >
        {!datos ? <SkeletonTabla filas={4} columnas={6} /> : (
          <TablaDatos
            titulo="Transformaciones completadas"
            columnas={columnas}
            filas={datos.filas}
            claveFila={f => f.t.id}
            ordenInicial={{ columna: 'fecha', sentido: 'desc' }}
            totales={{ etiqueta: 'Totales' }}
            paginacion={{ tamano: FILAS_POR_PAGINA }}
            exportar={{ nombreArchivo: 'transformaciones' }}
            anchoMinimo="min-w-[56rem]"
            tarjetaMovil={f => (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/transformaciones/${f.t.id}`} className="block truncate text-sm font-medium text-text-primary hover:text-brand-700 hover:underline">
                      {f.t.codigo && <span className="text-text-secondary">{f.t.codigo} · </span>}{nombreEntrada(f.t)}
                    </Link>
                    <p className="text-xs text-text-secondary">{formatearFecha(f.t.fecha)} · {etiquetaCategoria(f.t.categoria)}</p>
                  </div>
                  <CheckCircle2 size={14} className="mt-1 shrink-0 text-brand-600" aria-label="Completada" />
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-text-secondary">Entrada</dt><dd className="font-medium tabular-nums">{kgFino(f.m.kgEntrada)}</dd></div>
                  <div><dt className="text-text-secondary">Salidas</dt><dd className="font-medium tabular-nums">{kgFino(f.m.kgSalida)}</dd></div>
                  <div><dt className="text-text-secondary">Merma</dt><dd className="font-medium tabular-nums">{kgFino(f.m.kgMerma)} · <CeldaMermaPct f={f} umbral={umbral} /></dd></div>
                </dl>
                {f.t.salidas.length > 0 && <div className="mt-2"><ChipsSalidas t={f.t} max={4} /></div>}
              </div>
            )}
            vacio={hayFiltros
              ? { mensaje: 'Ninguna transformación completada coincide con los filtros.', accion: { etiqueta: 'Quitar filtros', onClick: onLimpiarFiltros } }
              : { mensaje: 'Aún no hay transformaciones completadas en este periodo.', descripcion: 'Aparecen aquí cuando se completa una transformación pendiente. Prueba con el periodo "Todo" para ver el historial completo.', accion: { etiqueta: 'Ver las pendientes', onClick: onIrAPendientes } }}
          />
        )}
      </Bloque>
    </div>
  );
}

export default PestanaHistorial;
