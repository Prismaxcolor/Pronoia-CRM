/**
 * Contrato de la pantalla nueva de /inventario (Fase 2-3 del rediseño).
 *
 * Cuatro endpoints de solo lectura, permiso productos:ver:
 *   GET /api/inventario/pantalla/detalle    -> { detalle:   DetallePantalla }
 *   GET /api/inventario/pantalla/categorias -> { categorias: CategoriasPantalla }
 *   GET /api/inventario/pantalla/flujo      -> { flujo:     FlujoPantalla }
 *   GET /api/inventario/pantalla/alertas    -> { alertas:   AlertasPantalla }
 * Filtros (query, todos opcionales): desde, hasta (YYYY-MM-DD, ambos o ninguno), categoria, almacen, q.
 * El detalle admite además `limite` (máx. filas), `vista` e `incluirClasificaciones` (true = mostrar también las clasificaciones de compra PCB sin lote).
 *
 * REGLAS QUE EL FRONTEND DEBE RESPETAR
 *  - Valores en USD: los materiales van a COSTO (valorCostoUsd) y los lotes a precio estimado de VENTA
 *    (valorEstimadoUsd). Son cifras distintas: NUNCA se suman entre sí.
 *  - Sin permiso facturacion:ver (valorOculto = true) todos los campos de costo/precio/valor vienen null.
 *  - Todo lo que dice "estimado" (días en inventario) se debe rotular "estimado" en la pantalla.
 *  - `parcial: true` = alguna lectura falló o venció: mostrar `avisos`; la cifra afectada no es completa.
 *  - Los filtros desde/hasta acotan lo que ocurre en el período (despachos, flujo, merma). El stock en galpón
 *    y su antigüedad estimada son siempre los de AHORA: una foto, no un período.
 *
 * DEFINICIONES (vista y etapa se derivan; nada de esto se guarda en la BD)
 *  Vista:
 *   - exportacion:     lotes de clase 'exportacion' (Lote 1-3 = PCB, Lote 4 = polvo de catalizador PGM) y su
 *                      ruta (materiales PGM: catalizador entero, que NUNCA se vende, y polvo).
 *   - venta_nacional:  Ferroso, No ferroso y Basura. Se venden tal cual en el mercado nacional.
 *   - trabajo_interno: lotes de clase 'trabajo' (por procesar / procesados), RAEE (desarme: se desarma y
 *                      alimenta lotes de trabajo, ferroso, no ferroso y basura; no se vende tal cual) y
 *                      PROCESADORES.
 *   - otras:           lo que no encaja en lo anterior (categoría desconocida, lotes de clase 'otro').
 *  PCB: las ~15 clasificaciones de compra (mixto 1, RAM dorada, teléfono...) son SOLO para comprar: toda tarjeta
 *  se almacena en un LOTE DE TRABAJO. Por eso el inventario de PCB son sus lotes, no sus clasificaciones. Un
 *  producto PCB con stock sin lote (no debería haber) se marca esClasificacionCompra y NO sale entre las filas
 *  ni las tarjetas; sus kg se informan aparte en kgClasificacionesCompraOcultas (se piden con
 *  incluirClasificaciones=true). Las clasificaciones solo aparecen como origen de compra en el flujo.
 *  Fase de un lote de trabajo (lotes.fase; si la columna aún no existe se deduce del nombre exacto):
 *   - por_procesar: LOTE MPP (mixto), BGPP (bajo grado), PCPP (PC). - procesado: BGYP, PCYP.
 *  Etapa (el recorrido real del PCB: por procesar -> procesado -> lote de exportación en saca -> embalado -> despachado):
 *   - recibido:   lote de trabajo 'por_procesar' (o sin fase definida) y material sin lote de exportación/trabajo
 *                 interno/otras (stock sin transformar aún).
 *   - en_proceso: lote de trabajo 'procesado', la parte de un lote de exportación aún en saca (sin embalar) y
 *                 kg retirados a una transformación en estado 'bruto' (ya NO están en el stock).
 *   - listo:      kg embalados vigentes de un lote de exportación (por kilos) y, en venta nacional,
 *                 el stock disponible.
 *   - despachado: kg de tickets de venta del período (ya salieron; no son stock).
 *  Marcas del material:
 *   - limpieza (No ferroso y Ferroso): productos.estado_limpieza si está definido (limpiezaOrigen
 *     'producto'); si es null, cae al nombre ('sucio' si contiene SUCIO, 'limpio' si contiene LIMPIO;
 *     limpiezaOrigen 'nombre'); sin ninguna pista, null (sin definir).
 *   - destinoBasura (DERIVADO DEL NOMBRE, mapa editable en backend/src/utils/inventario-vistas.ts):
 *     'recuperable' (BASURA BUENA, BASURA DE RECEPCION, CONECTORES DE PC, PANTALLAS) o 'desecho'
 *     (BASURA MALA, DESECHOS, BATERIAS (PILAS)); lo que no esté en el mapa queda null (sin clasificar).
 *  Días en inventario (ESTIMADO, sin capas FIFO): se asume que el stock actual se formó con las entradas
 *  más recientes (compras, salidas de transformación, ajustes de toma física positivos, con su fecha) y
 *  se pondera por kg. Los datos solo empiezan el 2026-09-16: no se inventa antigüedad previa; los kg del
 *  stock que ninguna entrada explica quedan en `kgSinFecha`.
 */
import type { ClaseLote } from './lote.js';

export type FaseLote = 'por_procesar' | 'procesado';
export type LimpiezaMaterial = 'limpio' | 'sucio';
export type DestinoBasura = 'recuperable' | 'desecho';

export type VistaInventario = 'exportacion' | 'venta_nacional' | 'trabajo_interno' | 'otras';
export type EtapaInventario = 'recibido' | 'en_proceso' | 'listo' | 'despachado';

// ---- comunes ------------------------------------------------------------------

export interface FiltrosPantalla {
  /** YYYY-MM-DD; con `hasta` define el período (por defecto, los últimos 30 días). */
  desde: string;
  hasta: string;
  /** Clave de categoría (ver FilaDetalleInventario.categoriaClave) o su nombre. */
  categoria: string | null;
  /** Id del almacén (uuid). */
  almacen: string | null;
  /** Búsqueda por texto en el nombre del material o lote (sin distinguir mayúsculas ni tildes). */
  q: string | null;
}

/** Campos comunes a las cuatro respuestas. */
export interface MetaPantalla {
  generadoEn: string;
  /** Sin facturacion:ver: costos, precios y valores vienen null. */
  valorOculto: boolean;
  /** true si alguna lectura falló o excedió el presupuesto de tiempo: ver avisos. */
  parcial: boolean;
  avisos: string[];
  filtros: FiltrosPantalla;
}

export interface KgAlmacen {
  almacenId: string;
  almacenNombre: string;
  kg: number;
}

export interface KgPorEtapa {
  recibido: number;
  enProceso: number;
  listo: number;
  despachado: number;
}

/** Antigüedad ESTIMADA del stock actual (ver definición arriba). */
export interface AntiguedadEstimada {
  /** Siempre true: rotular "estimado". */
  estimado: true;
  /** Antigüedad media ponderada por kg, en días enteros-decimales (1 decimal). */
  diasPromedio: number;
  /** Fecha (YYYY-MM-DD) de la entrada más antigua considerada para explicar el stock. */
  fechaEntradaMasAntigua: string;
  fechaEntradaMasReciente: string;
  /** Kg del stock explicados por entradas con fecha. */
  kgConFecha: number;
  /** Kg del stock que ninguna entrada registrada explica (no se les inventa fecha). */
  kgSinFecha: number;
}

// ---- (a) detalle: tabla única ---------------------------------------------------

export interface FilaDetalleInventario {
  /** Estable entre llamadas: 'mat:<productoId>' | 'lote:<loteId>' | 'transf:...' | 'desp:...'. */
  id: string;
  tipo: 'material' | 'lote';
  /**
   * true = kg que están hoy en el galpón (stock). false = fila informativa fuera del stock:
   * kg en transformación 'bruto' (etapa en_proceso) o kg despachados en el período.
   */
  enGalpon: boolean;
  /** Nombre del producto o del lote. */
  material: string;
  productoId: string | null;
  loteId: string | null;
  /** Agrupa la tabla: tipoMaterialId para materiales; 'lotes:exportacion' | 'lotes:trabajo' | 'lotes:otro' para lotes. */
  categoriaClave: string;
  categoria: string;
  vista: VistaInventario;
  /** Solo lotes. */
  clase: ClaseLote | null;
  /** Solo lotes de trabajo: fase (columna lotes.fase o deducida del nombre). null = sin definir / no aplica. */
  fase: FaseLote | null;
  /**
   * Limpieza del material (solo No ferroso y Ferroso): productos.estado_limpieza si está definido; si no,
   * derivada del nombre (SUCIO / LIMPIO); null = sin definir.
   */
  limpieza: LimpiezaMaterial | null;
  /** De dónde sale `limpieza`: el campo del producto, el nombre, o null (sin definir / no aplica). Opcional por compatibilidad. */
  limpiezaOrigen?: 'producto' | 'nombre' | null;
  /** DERIVADA DEL NOMBRE del material. Solo materiales de Basura. */
  destinoBasura: DestinoBasura | null;
  /** Producto PCB con stock sin lote: es una clasificación de compra, no inventario principal. */
  esClasificacionCompra: boolean;
  /** Etapa de la fila: 'listo' solo si todos sus kg están listos; un lote a medio embalar es 'en_proceso'. */
  etapa: EtapaInventario;
  /** Reparto de `kg` por etapa (en materiales casi siempre una sola etapa; en lotes mixtos, dos). */
  kgPorEtapa: KgPorEtapa;
  /** Stock en galpón (enGalpon) o kg en transformación / despachados (fila informativa). */
  kg: number;
  /** Solo lotes (stock = embalado + enSaca). */
  embaladoKg: number | null;
  enSacaKg: number | null;
  /** Materiales: costo promedio ponderado USD/kg de las compras; null = sin costo (o valorOculto). */
  costoPromedioKg: number | null;
  /** Materiales: kg x costo; null si no hay costo, kg <= 0 o valorOculto. */
  valorCostoUsd: number | null;
  /** Lotes: precio estimado de venta USD/kg cargado a mano; null = sin precio (o valorOculto). */
  precioEstimadoKg: number | null;
  /** Lotes: kg x precio estimado de venta (NO es costo); null sin precio o valorOculto. */
  valorEstimadoUsd: number | null;
  /** null en filas fuera del galpón o sin entradas que expliquen el stock. */
  dias: AntiguedadEstimada | null;
  /** G1/G2...: kg por almacén (solo almacenes con kg distintos de 0). */
  porAlmacen: KgAlmacen[];
}

export interface GrupoDetalle {
  categoriaClave: string;
  categoria: string;
  vista: VistaInventario;
  filas: number;
  /** Kg en galpón del grupo (suma de las filas enGalpon). */
  kg: number;
  valorCostoUsd: number | null;
  valorEstimadoUsd: number | null;
}

export interface DetallePantalla extends MetaPantalla {
  /** Ordenadas por categoría y, dentro de ella, por kg descendente. Pueden estar recortadas: ver `limite`. */
  filas: FilaDetalleInventario[];
  /** Un grupo por categoría (calculado sobre TODAS las filas, aunque se recorten). */
  grupos: GrupoDetalle[];
  /** Totales sobre TODAS las filas filtradas. kgEnGalpon = stock (cuadra con /resumen sin filtros). */
  totales: {
    kgEnGalpon: number;
    kgEnTransformacion: number;
    kgDespachado: number;
    valorCostoUsd: number | null;
    valorEstimadoUsd: number | null;
    /** Kg de clasificaciones de compra PCB sin lote que no salen entre las filas (kgEnGalpon + esto = /resumen). */
    kgClasificacionesCompraOcultas: number;
    /** Valor a costo (USD) de esas clasificaciones ocultas; null si no tienen costo o valorOculto. Opcional por compatibilidad. */
    valorClasificacionesCompraOcultasUsd?: number | null;
  };
  limite: { maxFilas: number; totalFilas: number; truncado: boolean };
}

// ---- (b) tarjetas por categoría y por vista --------------------------------------

export interface RendimientoExportacion {
  /** salidas / entradas x 100. */
  rendimientoPct: number;
  /** (entradas - salidas) / entradas x 100. */
  mermaPct: number;
  kgEntrada: number;
  kgSalida: number;
  kgMerma: number;
  transformaciones: number;
}

/** Barra apilada por etapa. recibido + enProceso + listo = kgEnGalpon + enTransformacionKg. */
export interface EtapasBarra {
  recibidoKg: number;
  enProcesoKg: number;
  listoKg: number;
}

export interface TarjetaInventario {
  /** categoriaClave (misma que en el detalle). */
  clave: string;
  nombre: string;
  vista: VistaInventario;
  /** 'categoria' = materiales de una categoría; 'lotes' = lotes de una clase (exportación, trabajo, otro). */
  tipo: 'categoria' | 'lotes';
  /** Stock en galpón. La suma de todas las tarjetas = totalKg de /resumen. */
  kgEnGalpon: number;
  /** Kg retirados a transformaciones en estado 'bruto' (no están en el stock; ya cuentan en enProcesoKg). */
  enTransformacionKg: number;
  etapas: EtapasBarra;
  /** Reparto derivado del nombre (solo materiales de No ferroso / Ferroso; null en el resto). Rotular "derivado del nombre". */
  desgloseLimpieza: { limpioKg: number; sucioKg: number; sinClasificarKg: number } | null;
  /** Reparto derivado del nombre (solo la tarjeta de Basura; null en el resto). */
  desgloseBasura: { recuperableKg: number; desechoKg: number; sinClasificarKg: number } | null;
  /** Solo la tarjeta de lotes de trabajo: kg por fase (por procesar / procesado / sin fase). */
  desgloseFase: { porProcesarKg: number; procesadoKg: number; sinFaseKg: number } | null;
  /** Kg despachados (tickets de venta) en el período. */
  despachadoKg: number;
  /** Solo materiales: valor a costo de los kg con costo; null = valorOculto o tarjeta de lotes. */
  valorCostoUsd: number | null;
  kgSinCosto: number | null;
  /** valorCostoUsd / kg con costo; null si no hay costo. */
  costoPromedioKg: number | null;
  /** Solo lotes: valor estimado de VENTA de los kg con precio; null = valorOculto o tarjeta de materiales. */
  valorEstimadoUsd: number | null;
  kgSinPrecio: number | null;
  precioPromedioEstimadoKg: number | null;
  /** Días promedio ESTIMADO ponderado por kg (rotular "estimado"); null si no hay entradas que lo expliquen. */
  dias: AntiguedadEstimada | null;
  /**
   * Solo en la vista exportación y para categorías de transformación (PCB, PGM...). null en las demás.
   * Con `sinTransformaciones: true` no hay transformaciones en el período: no se inventa rendimiento.
   */
  rendimiento: RendimientoExportacion | null;
  sinTransformaciones: boolean;
}

export interface TarjetaVista extends Omit<TarjetaInventario, 'clave' | 'nombre' | 'tipo' | 'rendimiento' | 'sinTransformaciones' | 'vista'> {
  vista: VistaInventario;
  tarjetas: number;
  /** Solo exportación (merma de las transformaciones de sus categorías); null en el resto. */
  rendimiento: RendimientoExportacion | null;
}

export interface CategoriasPantalla extends MetaPantalla {
  /** Una por categoría con stock o movimiento, y una por clase de lote con stock. Orden: vista, nombre. */
  tarjetas: TarjetaInventario[];
  /** Una por vista (aunque esté vacía). */
  vistas: TarjetaVista[];
  /** kg en galpón total de las tarjetas. totalKgEnGalpon + kgClasificacionesCompraOcultas = totalKg de /resumen. */
  totalKgEnGalpon: number;
  kgClasificacionesCompraOcultas: number;
}

// ---- (c) flujo Sankey ------------------------------------------------------------

export type TipoNodoFlujo =
  | 'compra'
  | 'ajuste'
  | 'categoria'
  | 'clasificacion'
  | 'lote_trabajo'
  | 'lote_exportacion'
  | 'lote_otro'
  | 'venta_directa'
  | 'despacho'
  | 'merma';

export interface NodoFlujo {
  /** Único: 'compra', 'ajuste', 'cat:<clave>', 'clas:<productoId>' (clasificación de compra PCB), 'lote:<id>', 'venta:<categoriaClave>', 'despacho', 'merma:<tipo>'. */
  id: string;
  tipo: TipoNodoFlujo;
  nombre: string;
  /**
   * Columna del diagrama (0 a 5); todo enlace va de una columna menor a una mayor, así que no hay ciclos:
   * 0 compra/ajuste, 1 categoría o clasificación de compra PCB, 2 lote de trabajo por procesar (o sin fase),
   * 3 lote de trabajo procesado, 4 lote de exportación u otro, 5 venta directa / despacho / merma.
   * (Antes eran 0 a 4 con trabajo en 2, exportación en 3 y destinos finales en 4: el 5 es nuevo.)
   */
  columna: 0 | 1 | 2 | 3 | 4 | 5;
  categoriaClave: string | null;
  loteId: string | null;
  /** max(kg que entran, kg que salen). */
  kg: number;
}

export interface EnlaceFlujo {
  origen: string;
  destino: string;
  kg: number;
}

export interface FlujoPantalla extends MetaPantalla {
  nodos: NodoFlujo[];
  enlaces: EnlaceFlujo[];
  /** true cuando no hay ningún flujo para los filtros: mostrar `mensajeSinDatos`, nunca un diagrama vacío. */
  sinDatos: boolean;
  mensajeSinDatos: string | null;
  /** Categorías con stock o compras en el período pero sin ninguna transformación: su flujo termina en la categoría. */
  categoriasSinTransformaciones: Array<{ clave: string; nombre: string }>;
  /**
   * Tramos del recorrido real que NO tienen datos registrados (p. ej. PCB y PGM se pesan directo a lotes de trabajo y
   * hoy no pasan por el registro de transformaciones). Mostrar "sin datos" en ese tramo; nunca inventar enlaces.
   */
  tramosSinDatos: Array<{ desde: string; hacia: string; motivo: string }>;
  /** true si ninguna transformación aparece en el flujo mostrado (ver mensajeSinDatos). */
  sinTransformaciones: boolean;
  /** Kg que no se pudieron dibujar sin crear un ciclo o con datos incoherentes (se informan, no se esconden). */
  enlacesOmitidos: Array<{ origen: string; destino: string; kg: number; motivo: string }>;
  totales: { kgComprado: number; kgTransformado: number; kgMerma: number; kgDespachado: number; transformaciones: number };
}

// ---- (d) alertas -------------------------------------------------------------------

export type TipoAlertaInventario = 'antiguedad' | 'merma_transformacion' | 'merma_periodo' | 'embalado_sin_contenedor';
export type SeveridadAlerta = 'info' | 'amarilla' | 'roja';

export interface EnlaceSugerido {
  /** Ruta de la app, p. ej. '/transformaciones/<id>' o '/inventario?categoria=<clave>&q=<texto>'. */
  ruta: string;
  etiqueta: string;
}

export interface AlertaInventario {
  /** Estable: tipo + entidad. */
  id: string;
  tipo: TipoAlertaInventario;
  /**
   * antiguedad: amarilla (> alertaDiasAmarilla) o roja (> alertaDiasRoja);
   * merma: amarilla sobre el umbral, roja sobre el doble del umbral; embalado sin contenedor: info.
   * El rojo solo se usa para alertas reales.
   */
  severidad: SeveridadAlerta;
  /** Texto listo para mostrar (ya en español, con las cifras). */
  texto: string;
  material: string | null;
  productoId: string | null;
  loteId: string | null;
  transformacionId: string | null;
  categoriaClave: string | null;
  /** Dato que disparó la alerta: días (estimados), % de merma o kg. */
  valor: number;
  umbral: number | null;
  unidad: 'dias' | 'pct' | 'kg';
  /** Fase del lote de trabajo al que se refiere (alertas de antigüedad); null en el resto. */
  fase: FaseLote | null;
  enlace: EnlaceSugerido;
}

export interface AlertasPantalla extends MetaPantalla {
  /** Rojas primero, luego amarillas e info; dentro de cada una, por valor descendente. */
  alertas: AlertaInventario[];
  conteo: { roja: number; amarilla: number; info: number; total: number };
  /** Umbrales vigentes (configuracion_inventario). */
  configuracion: {
    alertaDiasAmarilla: number;
    alertaDiasRoja: number;
    umbralMermaPct: number;
    /** Merma mínima (kg) para alertar; por debajo no se alerta aunque el % sea alto. Opcional por compatibilidad. */
    alertaMermaMinKg?: number;
  };
}
