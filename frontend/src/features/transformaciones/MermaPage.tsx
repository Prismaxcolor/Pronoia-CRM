import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  obtenerReporteMerma,
  type AgrupacionMerma,
  type FilaMerma,
  type PeriodoMerma,
  type ReporteMerma,
} from '../../services/transformacion-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerProductos } from '../../services/producto-service';
import type { Almacen, Producto } from '@shared/types/index.js';
import {
  BarrasVerticales, Bloque, ControlSegmentado, EncabezadoPagina, EstadoVacio, FiltrosBarra, GrillaKpis, Insignia, SkeletonBloque, SkeletonKpis,
  SkeletonTabla, TablaDatos, TarjetaKpi, formatearFecha, formatearNumero, formatearPct, useFiltrosUrl, type ColumnaTabla,
} from '../../components/ui';
import { compararConPeriodoAnterior } from '../../lib/comparacion';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import { etiquetaCortaPeriodo, rangoAnterior, severidadMerma } from '../../lib/transformaciones-kpis';
import {
  CATEGORIAS_TRANSFORMACION, OPCIONES_FILTRO_CATEGORIA, etiquetaCategoria, rangoEfectivo, useUmbralMerma, type UmbralMerma, kgFino } from './transformaciones-comun';
import type { EstadoReporte } from './BloquesMermaReporte';

const BloquesCategoriaYTipo = lazy(() => import('./BloquesMermaCategoriaYTipo'));

/** Filtros de /transformaciones/merma en la URL (todos nuevos: antes vivían solo en memoria). */
const ESQUEMA_MERMA: EsquemaFiltros = {
  campos: {
    desde: { tipo: 'fecha' },
    hasta: { tipo: 'fecha' },
    almacen: { tipo: 'texto' },
    material: { tipo: 'texto' },
    categoria: { tipo: 'opcion', opciones: CATEGORIAS_TRANSFORMACION },
    agrupar: { tipo: 'opcion', opciones: ['dia', 'semana', 'mes'] },
  },
  rangos: [['desde', 'hasta']],
};

const OPCIONES_AGRUPAR = [
  { valor: 'dia' as const, etiqueta: 'Día' },
  { valor: 'semana' as const, etiqueta: 'Semana' },
  { valor: 'mes' as const, etiqueta: 'Mes' },
];
const MS_DIA = 86_400_000;
const DIAS_MAX_AGRUPAR_DIA = 31;
const DIAS_MAX_AGRUPAR_SEMANA = 140;
const FILAS_POR_PAGINA = 20;
const RETARDO_BLOQUES_PESADOS_MS = 150;

/** Sin elección del usuario, la agrupación se ajusta a la duración del periodo para que la gráfica tenga forma. */
function agrupacionSugerida(desde: string, hasta: string): AgrupacionMerma {
  const dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MS_DIA) + 1;
  if (dias <= DIAS_MAX_AGRUPAR_DIA) return 'dia';
  return dias <= DIAS_MAX_AGRUPAR_SEMANA ? 'semana' : 'mes';
}

function etiquetaPeriodo(periodo: string, agrupar: AgrupacionMerma): string {
  if (agrupar === 'dia') return formatearFecha(periodo);
  if (agrupar === 'mes') return periodo.slice(0, 7);
  return `Semana del ${formatearFecha(periodo)}`;
}

/** Pide el reporte del periodo actual y, aparte, el del periodo anterior (solo para comparar los totales).
 *  Si cambian los filtros se conserva lo anterior (atenuado) hasta que llega lo nuevo. */
function useReportesMerma(p: { desde: string; hasta: string; almacenId: string; productoId: string; categoria: string; agrupar: AgrupacionMerma }) {
  const [estado, setEstado] = useState<{ clave: string | null; actual: ReporteMerma | null; anterior: ReporteMerma | null; error: string | null }>(
    { clave: null, actual: null, anterior: null, error: null },
  );
  const [version, setVersion] = useState(0);
  const clave = `${p.desde}|${p.hasta}|${p.almacenId}|${p.productoId}|${p.categoria}|${p.agrupar}|${version}`;
  useEffect(() => {
    let cancelado = false;
    const base = { almacenId: p.almacenId, productoId: p.productoId, categoria: p.categoria };
    const previo = rangoAnterior({ desde: p.desde, hasta: p.hasta });
    void Promise.allSettled([
      obtenerReporteMerma({ ...base, desde: p.desde, hasta: p.hasta, agrupar: p.agrupar }),
      obtenerReporteMerma({ ...base, desde: previo.desde, hasta: previo.hasta, agrupar: 'mes' }),
    ]).then(([a, b]) => {
      if (cancelado) return;
      setEstado(prev => ({
        clave,
        actual: a.status === 'fulfilled' ? a.value : prev.actual,
        anterior: b.status === 'fulfilled' ? b.value : null,
        error: a.status === 'rejected' ? (a.reason instanceof Error ? a.reason.message : 'No se pudo cargar el histórico de merma.') : null,
      }));
    });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la petición depende solo de la clave (los parámetros ya van dentro).
  }, [clave]);
  const reintentar = useCallback(() => setVersion(v => v + 1), []);
  return { ...estado, cargando: estado.clave !== clave, reintentar };
}

function CeldaPct({ pct, kgMerma, umbral }: { pct: number; kgMerma: number; umbral: UmbralMerma }) {
  const sev = kgMerma >= umbral.minimoKg ? severidadMerma(pct, umbral.umbralPct) : null;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      {sev && <Insignia forma="cuadrada" tono={sev === 'roja' ? 'peligro' : 'aviso'} title={`Supera el umbral de ${formatearNumero(umbral.umbralPct, 0)} %`}>Sobre umbral</Insignia>}
      {formatearPct(pct, 2)}
    </span>
  );
}

/** Volumen de entrada y salida no es "bueno" ni "malo": la comparación sale en gris. */
function comparacionNeutra(actual: number, anterior: number) {
  const c = compararConPeriodoAnterior(actual, anterior, 'sube');
  return c ? { ...c, tono: 'neutro' as const } : null;
}

const sumar = <T,>(filas: readonly T[], f: (t: T) => number) => filas.reduce((a, t) => a + f(t), 0);
const pctDe = (merma: number, entrada: number) => (entrada > 0 ? formatearPct((merma / entrada) * 100, 2) : '—');

function MermaPage() {
  const navigate = useNavigate();
  const umbral = useUmbralMerma();
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_MERMA);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const desdeUrl = str(filtros.desde);
  const hastaUrl = str(filtros.hasta);
  const rango = useMemo(() => rangoEfectivo(desdeUrl, hastaUrl), [desdeUrl, hastaUrl]);
  const almacenId = str(filtros.almacen) ?? '';
  const productoId = str(filtros.material) ?? '';
  const categoria = str(filtros.categoria) ?? '';
  const agrupar = (str(filtros.agrupar) as AgrupacionMerma | undefined) ?? agrupacionSugerida(rango.desde, rango.hasta);

  const [almacenes, setAlmacenes] = useState<Almacen[] | undefined>(undefined);
  const [productos, setProductos] = useState<Producto[] | undefined>(undefined);
  const [mostrarPesados, setMostrarPesados] = useState(false);
  useEffect(() => {
    void obtenerAlmacenes().then(setAlmacenes);
    void obtenerProductos().then(setProductos);
  }, []);

  const { actual: reporte, anterior, error, cargando, reintentar } = useReportesMerma({ ...rango, almacenId, productoId, categoria, agrupar });

  useEffect(() => {
    if (!reporte) return;
    const t = setTimeout(() => setMostrarPesados(true), RETARDO_BLOQUES_PESADOS_MS);
    return () => clearTimeout(t);
  }, [reporte]);

  const opcionesAlmacen = useMemo(() => almacenes?.map(a => ({ valor: a.id, etiqueta: a.nombre })), [almacenes]);
  const opcionesMaterial = useMemo(
    () => productos && [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre)).map(p => ({ valor: p.id, etiqueta: p.nombre })),
    [productos],
  );

  const totales = reporte?.totales;
  const previos = anterior && anterior.totales.transformaciones > 0 ? anterior.totales : null;
  const sinDatos = !totales || totales.transformaciones === 0;
  const sobreUmbral = Boolean(totales && totales.kgMerma >= umbral.minimoKg && totales.pctMerma > umbral.umbralPct);
  const hayFiltros = Boolean(desdeUrl || almacenId || productoId || categoria);

  const periodos = useMemo(() => [...(reporte?.periodos ?? [])], [reporte]);
  const estadoReporte: EstadoReporte = { reporte, error, cargando, reintentar };

  const columnasPeriodo: Array<ColumnaTabla<PeriodoMerma>> = useMemo(() => [
    { clave: 'periodo', titulo: 'Periodo', valorOrden: p => p.periodo, celda: p => etiquetaPeriodo(p.periodo, agrupar), valorCsv: p => p.periodo },
    { clave: 'transf', titulo: 'Transf.', alinear: 'derecha', valorOrden: p => p.transformaciones, total: ps => formatearNumero(sumar(ps, p => p.transformaciones), 0) },
    { clave: 'entrada', titulo: 'Entrada (kg)', alinear: 'derecha', valorOrden: p => p.kgEntrada, celda: p => formatearNumero(p.kgEntrada, 2), decimalesCsv: 3, total: ps => formatearNumero(sumar(ps, p => p.kgEntrada), 2) },
    { clave: 'salida', titulo: 'Salida (kg)', alinear: 'derecha', valorOrden: p => p.kgSalida, celda: p => formatearNumero(p.kgSalida, 2), decimalesCsv: 3, total: ps => formatearNumero(sumar(ps, p => p.kgSalida), 2) },
    { clave: 'merma', titulo: 'Merma (kg)', alinear: 'derecha', valorOrden: p => p.kgMerma, celda: p => formatearNumero(p.kgMerma, 2), decimalesCsv: 3, total: ps => formatearNumero(sumar(ps, p => p.kgMerma), 2) },
    {
      clave: 'pct', titulo: 'Merma %', alinear: 'derecha', valorOrden: p => p.pctMerma, valorCsv: p => p.pctMerma,
      celda: p => <CeldaPct pct={p.pctMerma} kgMerma={p.kgMerma} umbral={umbral} />,
      total: ps => pctDe(sumar(ps, p => p.kgMerma), sumar(ps, p => p.kgEntrada)),
    },
  ], [agrupar, umbral]);

  const columnasFilas: Array<ColumnaTabla<FilaMerma>> = useMemo(() => [
    { clave: 'fecha', titulo: 'Fecha', valorOrden: f => f.fecha, celda: f => formatearFecha(f.fecha), valorCsv: f => f.fecha },
    {
      clave: 'codigo', titulo: 'Transformación', valorOrden: f => f.codigo ?? '',
      celda: f => <Link to={`/transformaciones/${f.id}`} className="font-medium text-text-primary hover:text-brand-700 hover:underline">{f.codigo ?? '—'}</Link>,
    },
    { clave: 'categoria', titulo: 'Categoría', valorOrden: f => etiquetaCategoria(f.categoria), ocultaEnMovil: true },
    { clave: 'entrada', titulo: 'Entrada', valorOrden: f => f.entrada },
    { clave: 'almacen', titulo: 'Almacén', valorOrden: f => f.nombreAlmacen ?? '', celda: f => f.nombreAlmacen ?? '—', ocultaEnMovil: true },
    { clave: 'kgEntrada', titulo: 'Entrada (kg)', alinear: 'derecha', valorOrden: f => f.kgEntrada, celda: f => formatearNumero(f.kgEntrada, 2), decimalesCsv: 3, total: fs => formatearNumero(sumar(fs, f => f.kgEntrada), 2) },
    { clave: 'kgSalida', titulo: 'Salida (kg)', alinear: 'derecha', valorOrden: f => f.kgSalida, celda: f => formatearNumero(f.kgSalida, 2), decimalesCsv: 3, total: fs => formatearNumero(sumar(fs, f => f.kgSalida), 2) },
    { clave: 'kgMerma', titulo: 'Merma (kg)', alinear: 'derecha', valorOrden: f => f.kgMerma, celda: f => formatearNumero(f.kgMerma, 2), decimalesCsv: 3, total: fs => formatearNumero(sumar(fs, f => f.kgMerma), 2) },
    {
      clave: 'pct', titulo: 'Merma %', alinear: 'derecha', valorOrden: f => f.pctMerma, valorCsv: f => f.pctMerma,
      ayuda: `"Sobre umbral" aparece cuando pasa de ${formatearNumero(umbral.umbralPct, 0)} % y la merma es de al menos ${formatearNumero(umbral.minimoKg, 0)} kg.`,
      celda: f => <CeldaPct pct={f.pctMerma} kgMerma={f.kgMerma} umbral={umbral} />,
      total: fs => pctDe(sumar(fs, f => f.kgMerma), sumar(fs, f => f.kgEntrada)),
    },
    {
      clave: 'clasificada', titulo: 'Clasificada (kg)', alinear: 'derecha', ocultaEnMovil: true, valorOrden: f => f.kgTipificado ?? 0, decimalesCsv: 3,
      ayuda: 'Kg de la merma que se clasificaron por tipo (basura, plástico, tierra...) al completar la transformación.',
      celda: f => formatearNumero(f.kgTipificado ?? 0, 2),
    },
  ], [umbral]);

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina
        titulo="Merma"
        subtitulo="Cuánto se pierde al transformar: peso neto de entrada menos todo lo que salió, de las transformaciones completadas."
        migas={[{ etiqueta: 'Transformaciones', to: '/transformaciones' }, { etiqueta: 'Merma' }]}
      />

      <FiltrosBarra
        rango={{ desde: desdeUrl, hasta: hastaUrl, onCambiar: r => cambiar(r) }}
        selectores={[{ id: 'merma-almacen', etiqueta: 'Almacén', valor: almacenId || undefined, opciones: opcionesAlmacen, onCambiar: v => cambiar({ almacen: v }), textoTodas: 'Todos' }]}
        avanzados={[
          { id: 'merma-material', etiqueta: 'Material de entrada', valor: productoId || undefined, opciones: opcionesMaterial, onCambiar: v => cambiar({ material: v }), textoTodas: 'Todos' },
          { id: 'merma-categoria', etiqueta: 'Categoría', valor: categoria || undefined, opciones: OPCIONES_FILTRO_CATEGORIA, onCambiar: v => cambiar({ categoria: v }), textoTodas: 'Todas' },
        ]}
        onLimpiar={limpiar}
      />

      {error && (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">No se pudo cargar el histórico de merma.</p>
          <p className="mt-0.5 text-xs">{error}</p>
          <button type="button" onClick={reintentar} className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-red-100">Reintentar</button>
        </div>
      )}

      <section aria-label="Indicadores de merma" className={cargando && reporte ? 'opacity-60 transition-opacity' : ''}>
        {!totales ? (!error && <SkeletonKpis />) : (
          <GrillaKpis>
            <TarjetaKpi
              titulo="Entrada"
              ayuda="Suma del peso neto de entrada de las transformaciones completadas en el periodo y con los filtros elegidos."
              valor={formatearNumero(totales.kgEntrada, 0)}
              unidad="kg"
              subtitulo={`${formatearNumero(totales.transformaciones, 0)} ${totales.transformaciones === 1 ? 'transformación completada' : 'transformaciones completadas'}`}
              estado={sinDatos ? 'vacio' : 'listo'}
              mensajeVacio="Sin transformaciones completadas con estos filtros"
              comparacion={previos ? comparacionNeutra(totales.kgEntrada, previos.kgEntrada) : null}
              formatoDelta={d => `${formatearNumero(d, 0)} kg`}
            />
            <TarjetaKpi
              titulo="Salida"
              ayuda="Suma del neto de todo lo que salió de esas transformaciones (materiales sueltos y lotes de destino)."
              valor={formatearNumero(totales.kgSalida, 0)}
              unidad="kg"
              subtitulo="Producto obtenido"
              estado={sinDatos ? 'vacio' : 'listo'}
              mensajeVacio="Sin transformaciones completadas con estos filtros"
              comparacion={previos ? comparacionNeutra(totales.kgSalida, previos.kgSalida) : null}
              formatoDelta={d => `${formatearNumero(d, 0)} kg`}
            />
            <TarjetaKpi
              titulo="Merma"
              ayuda="Entrada menos salida: lo que se perdió en el proceso, en kilos."
              valor={formatearNumero(totales.kgMerma, 0)}
              unidad="kg"
              subtitulo="Entrada - salida"
              estado={sinDatos ? 'vacio' : 'listo'}
              mensajeVacio="Sin transformaciones completadas con estos filtros"
              comparacion={previos ? compararConPeriodoAnterior(totales.kgMerma, previos.kgMerma, 'baja') : null}
              formatoDelta={d => `${formatearNumero(d, 0)} kg`}
            />
            <TarjetaKpi
              titulo="Merma %"
              ayuda={`Merma sobre el peso de entrada. Se pinta en rojo solo si pasa del umbral de ${formatearNumero(umbral.umbralPct, 0)} % con al menos ${formatearNumero(umbral.minimoKg, 0)} kg de merma.${umbral.esPorDefecto ? ' (Umbral por defecto: no se pudo leer la configuración del inventario.)' : ''}`}
              valor={formatearNumero(totales.pctMerma, 2)}
              unidad="%"
              subtitulo={`Umbral ${formatearNumero(umbral.umbralPct, 0)} % · rendimiento ${formatearPct(100 - totales.pctMerma, 2)}`}
              tonoValor={sobreUmbral ? 'peligro' : 'normal'}
              estado={sinDatos ? 'vacio' : 'listo'}
              mensajeVacio="Sin transformaciones completadas con estos filtros"
              comparacion={previos ? compararConPeriodoAnterior(totales.pctMerma, previos.pctMerma, 'baja') : null}
              formatoDelta={d => `${formatearNumero(d, 2)} pp`}
            />
          </GrillaKpis>
        )}
      </section>

      <Bloque
        titulo="Merma por periodo"
        queEstasViendo="los kilos de merma de cada periodo. Cambia la agrupación para ver el detalle por día, semana o mes."
        acciones={<ControlSegmentado opciones={OPCIONES_AGRUPAR} valor={agrupar} onCambiar={v => cambiar({ agrupar: v })} etiquetaAria="Agrupar por" />}
      >
        {!reporte ? (!error && <SkeletonBloque alto="h-56" />) : periodos.length < 2 ? (
          <EstadoVacio
            mensaje={periodos.length === 0 ? 'Sin transformaciones completadas con estos filtros.' : 'Hay un solo periodo con datos: la gráfica necesita al menos dos para comparar.'}
            descripcion={periodos.length === 0 ? 'Prueba con otro periodo o quita los filtros.' : 'Agrupa por un periodo más corto (por ejemplo por día) o amplía el rango de fechas.'}
            accion={hayFiltros ? { etiqueta: 'Quitar filtros', onClick: limpiar } : undefined}
          />
        ) : (
          <div className={`rounded-xl border border-border bg-surface p-3 ${cargando ? 'opacity-60 transition-opacity' : ''}`}>
            <BarrasVerticales
              categorias={periodos.map(p => etiquetaCortaPeriodo(p.periodo, agrupar))}
              series={[{ etiqueta: 'Merma (kg)', valores: periodos.map(p => Math.max(0, p.kgMerma)) }]}
              formatoValor={v => kgFino(v)}
              etiquetaAria={`Kilos de merma por ${agrupar === 'dia' ? 'día' : agrupar === 'semana' ? 'semana' : 'mes'}`}
            />
          </div>
        )}
      </Bloque>

      {reporte && mostrarPesados ? (
        <Suspense fallback={<SkeletonBloque alto="h-56" conMargen />}>
          <BloquesCategoriaYTipo estado={estadoReporte} onIrAPendientes={() => navigate('/transformaciones?tab=pendientes')} />
        </Suspense>
      ) : (
        !error && <SkeletonBloque alto="h-56" conMargen />
      )}

      <Bloque titulo="Resumen por periodo" queEstasViendo="los totales de cada periodo en una tabla. Puedes ordenarla y exportarla.">
        {!reporte ? (!error && <SkeletonTabla filas={3} columnas={6} />) : (
          <TablaDatos
            titulo="Resumen de merma por periodo"
            columnas={columnasPeriodo}
            filas={periodos}
            claveFila={p => p.periodo}
            ordenInicial={{ columna: 'periodo', sentido: 'desc' }}
            totales={{ etiqueta: 'Total' }}
            exportar={{ nombreArchivo: 'merma-por-periodo' }}
            vacio={{ mensaje: 'Sin transformaciones completadas con estos filtros.', accion: hayFiltros ? { etiqueta: 'Quitar filtros', onClick: limpiar } : { etiqueta: 'Ver el historial de transformaciones', to: '/transformaciones?tab=historial' } }}
          />
        )}
      </Bloque>

      <Bloque titulo="Detalle por transformación" queEstasViendo="cada transformación completada con su entrada, salida y merma. Entra al código para ver su detalle.">
        {!reporte ? (!error && <SkeletonTabla filas={4} columnas={6} />) : (
          <TablaDatos
            titulo="Merma por transformación"
            columnas={columnasFilas}
            filas={reporte.filas}
            claveFila={f => f.id}
            ordenInicial={{ columna: 'fecha', sentido: 'desc' }}
            totales={{ etiqueta: 'Total' }}
            paginacion={{ tamano: FILAS_POR_PAGINA }}
            exportar={{ nombreArchivo: 'merma-por-transformacion' }}
            anchoMinimo="min-w-[60rem]"
            vacio={{ mensaje: 'Sin transformaciones completadas con estos filtros.', accion: hayFiltros ? { etiqueta: 'Quitar filtros', onClick: limpiar } : { etiqueta: 'Ver las pendientes por completar', to: '/transformaciones?tab=pendientes' } }}
          />
        )}
      </Bloque>

    </div>
  );
}

export default MermaPage;
