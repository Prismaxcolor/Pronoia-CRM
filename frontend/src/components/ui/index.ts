/**
 * KIT DE COMPONENTES DE PRONOIA ("el lenguaje de /inventario")
 * ============================================================
 * La pantalla /inventario (features/inventario/nuevo/*) es el estándar de diseño aprobado. Este kit contiene sus piezas
 * generalizadas para rediseñar el resto de pantallas con el mismo lenguaje. Importa desde aquí:
 *
 *   import { EncabezadoPagina, Bloque, GrillaKpis, TarjetaKpi, TablaDatos } from '../../components/ui';
 *
 * Cada módulo es pequeño, sin efectos secundarios, y se puede importar por separado (el bundler descarta lo que no uses;
 * las gráficas y la tabla solo entran al bundle de las pantallas que las usan). Para cargarlas de forma diferida usa
 * React.lazy con la ruta directa: lazy(() => import('../../components/ui/TablaDatos')).
 *
 * REGLAS DE ESTILO (obligatorias al rediseñar una pantalla)
 * ---------------------------------------------------------
 * 1. ESTRUCTURA. Arriba, <EncabezadoPagina> (un h1 y una línea que dice para qué sirve la pantalla). Debajo, filtros,
 *    luego indicadores, luego bloques. Cada <Bloque> = UN título (h2) + UNA línea "Qué estás viendo" en lenguaje llano.
 * 2. INDICADORES. Máximo 4 <TarjetaKpi> por fila (<GrillaKpis>: 1 columna en móvil, 2 en tablet, 4 en escritorio). Cada
 *    una: título + "?" que explica qué significa y cómo se calcula, valor grande CON su unidad, subtítulo con el origen
 *    de la cifra y, si hay periodo anterior, comparación con flecha y semántica bueno/malo (comparacion={null} = "—":
 *    nunca se inventa un dato). Móvil primero: lo más importante va arriba y las tarjetas se apilan.
 * 3. COLOR. Verde de marca (o azul con data-marca='azul') para acción principal y estado "listo". El ROJO es solo para
 *    alertas reales y errores (severidad 'roja', umbral superado), nunca para decorar ni para estados normales (una
 *    factura anulada es neutra). El color NUNCA va solo: siempre hay texto, símbolo o forma que diga lo mismo.
 *    Categorías de material: colores fijos de lib/colores-categoria.ts. Estados/tipos/severidades: lib/paleta.ts.
 * 4. NÚMEROS. Siempre es-VE con miles y unidad: "1.234 kg", "USD 5.000", "12,5 %", fechas dd/mm/aaaa (lib/formato.ts).
 *    Cifras con tabular-nums y alineadas a la derecha en tablas. Un valor desconocido se muestra "—", no 0.
 * 5. ESTADOS VACÍOS. Nunca un hueco mudo: <EstadoVacio> explica POR QUÉ no hay datos y ofrece la acción (enlace o botón)
 *    que lo resuelve. Mientras carga, skeletons con la forma del contenido (Skeletons.tsx), no un spinner genérico.
 * 6. GRÁFICAS. SVG propio y ligero (components/ui/graficas). Barras horizontales para rankings, barras verticales para
 *    periodos, línea para evolución, dona SOLO para 2 a 5 partes (nada de tortas de más de 5 partes; el resto se agrupa
 *    en "Otros"; nunca 3D). Siempre con leyenda y valores en texto, resumen accesible y tooltip por hover/foco/toque.
 * 7. TABLAS. <TablaDatos>: ordenable (aria-sort), agrupada si hay categorías, con fila de totales y "Exportar CSV".
 *    En móvil las filas se apilan como tarjetas. Los filtros que se pueden compartir viven en la URL (useFiltrosUrl).
 * 8. ACCESIBILIDAD. Todo usable con teclado (foco visible con anillo de marca), roles ARIA correctos (radiogroup,
 *    tablist, progressbar, aria-sort), áreas táctiles cómodas y textos de ayuda enlazados (aria-describedby).
 * 9. CARGA. Lo pesado (gráficas, tablas grandes) se carga con React.lazy DESPUÉS de los indicadores, y cada bloque
 *    maneja su propio error con opción de reintentar sin tumbar la pantalla.
 *
 * Referencia de uso completa: src/features/inventario/nuevo/ (la pantalla aprobada).
 */

// Estructura de página
export { default as EncabezadoPagina } from './EncabezadoPagina';
export type { EncabezadoPaginaProps, Miga } from './EncabezadoPagina';
export { default as Bloque } from './Bloque';
export type { BloqueProps } from './Bloque';
export { default as BotonAccion } from './BotonAccion';
export type { BotonAccionProps } from './BotonAccion';

// Indicadores
export { default as TarjetaKpi, ComparacionKpi } from './TarjetaKpi';
export type { TarjetaKpiProps, ComparacionKpiProps } from './TarjetaKpi';
export { default as GrillaKpis } from './GrillaKpis';
export { default as InfoTooltip } from './InfoTooltip';
export type { InfoTooltipProps } from './InfoTooltip';

// Estados
export { default as EstadoVacio } from './EstadoVacio';
export type { EstadoVacioProps, AccionVacio } from './EstadoVacio';
export { SkeletonBloque, SkeletonTarjeta, SkeletonKpis, SkeletonTabla, SkeletonGrafica } from './Skeletons';
export { default as Insignia, InsigniaEstado } from './Insignia';
export type { InsigniaProps } from './Insignia';

// Controles
export { default as Chip } from './Chip';
export type { ChipProps } from './Chip';
export { default as ControlSegmentado } from './ControlSegmentado';
export type { ControlSegmentadoProps, OpcionSegmentada } from './ControlSegmentado';
export { default as Pestanas } from './Pestanas';
export type { PestanasProps, PestanaDef } from './Pestanas';
export { default as FiltrosBarra } from './FiltrosBarra';
export type { FiltrosBarraProps, SelectorFiltro, OpcionFiltro, RangoFiltro, BuscadorFiltro } from './FiltrosBarra';
export { useFiltrosUrl } from '../../hooks/use-filtros-url';
/** Confirmación de acciones destructivas o irreversibles: ya existe el hook global (ConfirmProvider en App.tsx). Uso:
 *  const confirmar = useConfirm(); if (await confirmar({ titulo, mensaje, variante: 'danger' })) { ... } */
export { useConfirm } from '../../hooks/use-confirm-context';

// Barras
export { default as BarraProgreso } from './BarraProgreso';
export { porcentajeProgreso } from './progreso';
export type { BarraProgresoProps } from './BarraProgreso';
export { default as BarraApilada } from './BarraApilada';
export type { BarraApiladaProps, SegmentoApilado } from './BarraApilada';

// Alertas
export { default as ListaAlertas, AlertaItem } from './ListaAlertas';
export { ordenarPorSeveridad } from './alertas-orden';
export type { ListaAlertasProps, AlertaItemProps, AlertaDatos } from './ListaAlertas';

// Tabla
export { default as TablaDatos } from './TablaDatos';
export type { TablaDatosProps, AgruparTabla, SeleccionTabla } from './TablaDatos';
export type { ColumnaTabla, OrdenTabla } from '../../lib/tabla-datos';
export { construirCsv, exportarCsv, nombreArchivoCsv } from '../../lib/csv';
export type { ColumnaCsv } from '../../lib/csv';

// Gráficas SVG ligeras
export { default as BarrasHorizontales } from './graficas/BarrasHorizontales';
export type { BarrasHorizontalesProps, DatoBarraHorizontal } from './graficas/BarrasHorizontales';
export { default as BarrasVerticales } from './graficas/BarrasVerticales';
export type { BarrasVerticalesProps, SerieBarras } from './graficas/BarrasVerticales';
export { default as LineaTiempo, Sparkline } from './graficas/LineaTiempo';
export type { LineaTiempoProps, PuntoTiempo, SparklineProps } from './graficas/LineaTiempo';
export { default as Dona } from './graficas/Dona';
export type { DonaProps } from './graficas/Dona';
export { default as MiniBarraTendencia } from './graficas/MiniBarraTendencia';
export type { MiniBarraTendenciaProps } from './graficas/MiniBarraTendencia';

// Utilidades de formato y paleta (re-exportadas por comodidad)
export * from '../../lib/formato';
export { ESTILOS_TONO, SEVERIDADES, infoEstado, infoTipoOperacion, colorDeSerie, PALETA_SERIES } from '../../lib/paleta';
export type { Tono, Severidad } from '../../lib/paleta';
