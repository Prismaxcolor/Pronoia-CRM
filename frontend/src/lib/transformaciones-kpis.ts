/** Lógica pura (sin React) de los indicadores de Transformaciones y Merma: merma por transformación, resumen de un
 *  periodo, periodo anterior comparable, alertas (pendientes viejas y merma sobre el umbral) y geometría del diagrama
 *  entrada -> salidas -> merma. Definición de merma idéntica a la del backend (utils/merma-transformacion.ts):
 *  merma = peso neto de entrada - suma del neto de todas las salidas. Se prueba desde backend/tests. */

/** Forma mínima de una transformación (la `Transformacion` compartida la cumple). */
export interface TransformacionBasica {
  id: string;
  codigo: string | null;
  categoria: string;
  estado: 'bruto' | 'completa' | string;
  fecha: string;
  pesoNeto: number;
  nombreProductoEntrada: string | null;
  nombreLoteOrigen: string | null;
  salidas: ReadonlyArray<{ pesoNeto: number }>;
}

export interface MermaTransformacion {
  kgEntrada: number;
  kgSalida: number;
  kgMerma: number;
  /** Porcentaje sobre la entrada con 2 decimales (0 si no hay entrada). */
  pctMerma: number;
}

export interface ResumenPeriodo extends MermaTransformacion {
  transformaciones: number;
}

export interface RangoFechas { desde: string; hasta: string }

/** Una merma menor a este valor no genera alerta (igual que el inventario: evita ruido con pesos pequeños). */
export const MERMA_MINIMA_ALERTA_KG = 5;
/** Umbral de merma por defecto (configuracion_inventario.umbral_merma_pct). */
export const UMBRAL_MERMA_PCT_POR_DEFECTO = 8;
/** Días sin completar a partir de los cuales una transformación pendiente se avisa (amarilla) y se marca urgente (roja). */
export const DIAS_PENDIENTE_AVISO = 3;
export const DIAS_PENDIENTE_URGENTE = 7;
const MS_DIA = 86_400_000;

const redondear = (n: number, d: number): number => Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d + 0;
const kg = (n: number) => redondear(n, 3);
const pct = (merma: number, entrada: number) => (entrada > 0 ? redondear((merma / entrada) * 100, 2) : 0);

/** Fecha "AAAA-MM-DD" -> día UTC (número de días desde 1970), para restar fechas sin zona horaria. */
function diaUtc(fecha: string): number {
  return Math.floor(Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`) / MS_DIA);
}
const aIso = (dia: number) => new Date(dia * MS_DIA).toISOString().slice(0, 10);

export function mermaTransformacion(t: Pick<TransformacionBasica, 'pesoNeto' | 'salidas'>): MermaTransformacion {
  const kgEntrada = kg(t.pesoNeto);
  const kgSalida = kg(t.salidas.reduce((a, s) => a + s.pesoNeto, 0));
  const kgMerma = kg(t.pesoNeto - t.salidas.reduce((a, s) => a + s.pesoNeto, 0));
  return { kgEntrada, kgSalida, kgMerma, pctMerma: pct(kgMerma, kgEntrada) };
}

/** Resumen de las transformaciones COMPLETAS de la lista (las pendientes no tienen salidas: no cuentan como merma). */
export function resumirPeriodo(lista: readonly TransformacionBasica[]): ResumenPeriodo {
  const completas = lista.filter(t => t.estado === 'completa');
  const kgEntrada = kg(completas.reduce((a, t) => a + t.pesoNeto, 0));
  const kgSalida = kg(completas.reduce((a, t) => a + t.salidas.reduce((s, x) => s + x.pesoNeto, 0), 0));
  const kgMerma = kg(kgEntrada - kgSalida);
  return { transformaciones: completas.length, kgEntrada, kgSalida, kgMerma, pctMerma: pct(kgMerma, kgEntrada) };
}

/** Rendimiento = 100 - merma %, con 2 decimales. */
export const rendimientoPct = (pctMerma: number): number => redondear(100 - pctMerma, 2);

export interface FiltroTransformaciones {
  estado?: 'bruto' | 'completa';
  desde?: string;
  hasta?: string;
  categoria?: string;
  /** Predicado de búsqueda por texto (el componente aporta coincideCodigo + nombre). */
  coincide?: (t: TransformacionBasica) => boolean;
}

export function filtrarTransformaciones<T extends TransformacionBasica>(lista: readonly T[], f: FiltroTransformaciones): T[] {
  return lista.filter(t => {
    if (f.estado && t.estado !== f.estado) return false;
    if (f.categoria && t.categoria !== f.categoria) return false;
    if (f.desde && t.fecha < f.desde) return false;
    if (f.hasta && t.fecha > f.hasta) return false;
    return f.coincide ? f.coincide(t) : true;
  });
}

/** Periodo inmediatamente anterior y de la misma duración (en días corridos, ambos extremos incluidos). */
export function rangoAnterior(rango: RangoFechas): RangoFechas {
  const d0 = diaUtc(rango.desde);
  const dias = diaUtc(rango.hasta) - d0 + 1;
  return { desde: aIso(d0 - dias), hasta: aIso(d0 - 1) };
}

export interface ComparacionPeriodos {
  actual: ResumenPeriodo;
  /** null = el periodo anterior no tiene transformaciones completas: "sin historial comparable" (no se inventa nada). */
  anterior: ResumenPeriodo | null;
  rangoAnterior: RangoFechas;
}

export function compararPeriodos(lista: readonly TransformacionBasica[], rango: RangoFechas, categoria?: string): ComparacionPeriodos {
  const previo = rangoAnterior(rango);
  const actual = resumirPeriodo(filtrarTransformaciones(lista, { estado: 'completa', categoria, ...rango }));
  const anterior = resumirPeriodo(filtrarTransformaciones(lista, { estado: 'completa', categoria, ...previo }));
  return { actual, anterior: anterior.transformaciones > 0 ? anterior : null, rangoAnterior: previo };
}

// ------------------------------------------------------------------ pendientes

/** Días transcurridos desde la fecha de la transformación (nunca negativo). `hoy` se pasa de afuera. */
export function diasPendiente(fecha: string, hoy: string): number {
  return Math.max(0, diaUtc(hoy) - diaUtc(fecha));
}

export interface ResumenPendientes {
  cantidad: number;
  kgEnEspera: number;
  /** Días de la más antigua (null si no hay pendientes). */
  diasMasAntigua: number | null;
  idMasAntigua: string | null;
}

export function resumirPendientes(lista: readonly TransformacionBasica[], hoy: string): ResumenPendientes {
  const pend = lista.filter(t => t.estado === 'bruto');
  let masAntigua: TransformacionBasica | null = null;
  for (const t of pend) if (!masAntigua || t.fecha < masAntigua.fecha) masAntigua = t;
  return {
    cantidad: pend.length,
    kgEnEspera: kg(pend.reduce((a, t) => a + t.pesoNeto, 0)),
    diasMasAntigua: masAntigua ? diasPendiente(masAntigua.fecha, hoy) : null,
    idMasAntigua: masAntigua?.id ?? null,
  };
}

export type SeveridadAlertaTransformacion = 'roja' | 'amarilla' | 'info';

export interface AlertaPendiente {
  id: string;
  severidad: SeveridadAlertaTransformacion;
  dias: number;
  transformacionId: string;
}

/** Pendientes con más de DIAS_PENDIENTE_AVISO días (amarilla) o más de DIAS_PENDIENTE_URGENTE (roja). */
export function alertasPendientes(lista: readonly TransformacionBasica[], hoy: string): AlertaPendiente[] {
  const alertas: AlertaPendiente[] = [];
  for (const t of lista) {
    if (t.estado !== 'bruto') continue;
    const dias = diasPendiente(t.fecha, hoy);
    if (dias <= DIAS_PENDIENTE_AVISO) continue;
    alertas.push({ id: `pendiente:${t.id}`, severidad: dias > DIAS_PENDIENTE_URGENTE ? 'roja' : 'amarilla', dias, transformacionId: t.id });
  }
  return alertas.sort((a, b) => b.dias - a.dias);
}

// ------------------------------------------------------------------ merma sobre el umbral

export interface AlertaMerma {
  id: string;
  severidad: SeveridadAlertaTransformacion;
  transformacionId: string;
  pctMerma: number;
  kgMerma: number;
}

/** Misma regla que las alertas del inventario: merma > umbral (amarilla) o > el doble del umbral (roja), y solo si la
 *  merma es de al menos `minimoKg` kg. */
export function severidadMerma(pctMerma: number, umbral: number): SeveridadAlertaTransformacion | null {
  if (!(pctMerma > umbral)) return null;
  return pctMerma > umbral * 2 ? 'roja' : 'amarilla';
}

export function alertasMerma(
  completas: readonly TransformacionBasica[],
  umbral: number = UMBRAL_MERMA_PCT_POR_DEFECTO,
  minimoKg: number = MERMA_MINIMA_ALERTA_KG,
): AlertaMerma[] {
  const alertas: AlertaMerma[] = [];
  for (const t of completas) {
    if (t.estado !== 'completa') continue;
    const m = mermaTransformacion(t);
    if (!(m.kgEntrada > 0) || m.kgMerma < minimoKg) continue;
    const severidad = severidadMerma(m.pctMerma, umbral);
    if (severidad) alertas.push({ id: `merma:${t.id}`, severidad, transformacionId: t.id, pctMerma: m.pctMerma, kgMerma: m.kgMerma });
  }
  return alertas.sort((a, b) => b.pctMerma - a.pctMerma);
}

// ------------------------------------------------------------------ series para gráficas

export interface PuntoMermaTransformacion {
  id: string;
  /** Etiqueta corta: el código o, si no hay, la fecha. */
  etiqueta: string;
  fecha: string;
  pctMerma: number;
  kgMerma: number;
}

/** Las `max` transformaciones completas más recientes (por fecha y luego por número de creación implícito del orden de
 *  entrada), devueltas de la más antigua a la más reciente para dibujarlas en orden cronológico. */
export function mermaPorTransformacionReciente(completas: readonly TransformacionBasica[], max = 12): PuntoMermaTransformacion[] {
  const filas = completas
    .filter(t => t.estado === 'completa' && t.pesoNeto > 0)
    .map((t, i) => ({ t, i, m: mermaTransformacion(t) }))
    .sort((a, b) => (a.t.fecha === b.t.fecha ? a.i - b.i : a.t.fecha.localeCompare(b.t.fecha)));
  return filas.slice(-max).map(({ t, m }) => ({
    id: t.id,
    etiqueta: t.codigo ?? t.fecha.slice(5),
    fecha: t.fecha,
    pctMerma: m.pctMerma,
    kgMerma: m.kgMerma,
  }));
}

/** ¿Hay merma clasificada por tipo en el desglose? (La dona solo se dibuja si hay datos.) */
export function hayMermaClasificada(porTipo: { tipos: ReadonlyArray<{ kg: number }> } | null | undefined): boolean {
  return Boolean(porTipo && porTipo.tipos.some(t => t.kg > 0));
}

// ------------------------------------------------------------------ diagrama entrada -> salidas -> merma

export interface NodoDiagrama {
  id: string;
  etiqueta: string;
  kg: number;
  /** 'merma' se pinta distinto (con trama) aparte del color. */
  tipo: 'entrada' | 'salida' | 'merma';
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export interface EnlaceDiagrama {
  origen: string;
  destino: string;
  kg: number;
  /** Cinta SVG cerrada con grosor proporcional a los kg. */
  ruta: string;
  grosor: number;
}

export interface DiagramaFlujo {
  nodos: NodoDiagrama[];
  enlaces: EnlaceDiagrama[];
  ancho: number;
  alto: number;
}

export interface EntradaDiagrama {
  entrada: { etiqueta: string; kg: number };
  salidas: ReadonlyArray<{ id: string; etiqueta: string; kg: number }>;
  /** kg de merma (puede ser <= 0: entonces no se dibuja el nodo de merma). */
  mermaKg: number;
}

const ANCHO_NODO = 14;
const SEPARACION = 10;
const ALTO_MINIMO = 6;

/** Layout de 3 columnas: la entrada a la izquierda, las salidas (y la merma como última) a la derecha. El alto de cada
 *  nodo y el grosor de su cinta son proporcionales a los kg (con un mínimo para que se vea); si la suma de salidas más
 *  merma supera la entrada, la escala se calcula sobre el mayor de los dos lados. Sin entrada válida devuelve null. */
export function construirDiagramaFlujo(d: EntradaDiagrama, ancho = 640, altoMax = 260): DiagramaFlujo | null {
  if (!(d.entrada.kg > 0)) return null;
  const derechos = [
    ...d.salidas.filter(s => s.kg > 0).map(s => ({ id: s.id, etiqueta: s.etiqueta, kg: s.kg, tipo: 'salida' as const })),
    ...(d.mermaKg > 0 ? [{ id: 'merma', etiqueta: 'Merma', kg: d.mermaKg, tipo: 'merma' as const }] : []),
  ];
  if (derechos.length === 0) return null;
  const totalDerecha = derechos.reduce((a, n) => a + n.kg, 0);
  const referencia = Math.max(d.entrada.kg, totalDerecha);
  const espacioUtil = altoMax - SEPARACION * (derechos.length - 1);
  const escala = espacioUtil / referencia;
  const altoNodo = (valor: number) => Math.max(ALTO_MINIMO, valor * escala);

  const xDer = ancho - ANCHO_NODO;
  let yAcum = 0;
  const nodosDer: NodoDiagrama[] = derechos.map(n => {
    const alto = altoNodo(n.kg);
    const nodo: NodoDiagrama = { id: n.id, etiqueta: n.etiqueta, kg: n.kg, tipo: n.tipo, x: xDer, y: yAcum, ancho: ANCHO_NODO, alto };
    yAcum += alto + SEPARACION;
    return nodo;
  });
  const altoDer = yAcum - SEPARACION;
  const altoEntrada = altoNodo(d.entrada.kg);
  const alto = Math.max(altoDer, altoEntrada);
  const nodoEntrada: NodoDiagrama = {
    id: 'entrada', etiqueta: d.entrada.etiqueta, kg: d.entrada.kg, tipo: 'entrada',
    x: 0, y: (alto - altoEntrada) / 2, ancho: ANCHO_NODO, alto: altoEntrada,
  };

  // Cada cinta sale de la entrada apilada de arriba hacia abajo, con su grosor proporcional.
  let ySalida = nodoEntrada.y;
  const x0 = ANCHO_NODO;
  const x1 = xDer;
  const xm = (x0 + x1) / 2;
  const enlaces: EnlaceDiagrama[] = nodosDer.map(n => {
    const grosorOrigen = Math.min(n.alto, Math.max(1, (n.kg / d.entrada.kg) * altoEntrada));
    const o0 = ySalida;
    const o1 = ySalida + grosorOrigen;
    ySalida = o1;
    const t0 = n.y;
    const t1 = n.y + n.alto;
    const ruta = `M${x0},${o0} C${xm},${o0} ${xm},${t0} ${x1},${t0} L${x1},${t1} C${xm},${t1} ${xm},${o1} ${x0},${o1} Z`;
    return { origen: 'entrada', destino: n.id, kg: n.kg, ruta, grosor: n.alto };
  });

  return { nodos: [nodoEntrada, ...nodosDer], enlaces, ancho, alto };
}

// ------------------------------------------------------------------ barras por periodo (Merma)

/** Etiqueta corta de un periodo del reporte de merma para el eje: día "04/10", semana "04/10", mes "oct 26". */
export function etiquetaCortaPeriodo(periodo: string, agrupar: 'dia' | 'semana' | 'mes'): string {
  const [a, m, d] = periodo.slice(0, 10).split('-');
  if (!a || !m || !d) return periodo;
  if (agrupar === 'mes') {
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${meses[Number(m) - 1] ?? m} ${a.slice(2)}`;
  }
  return `${d}/${m}`;
}
