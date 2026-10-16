// Saldo del inventario al cierre de un día (lógica pura, sin BD).
// El saldo se reconstruye con los mismos movimientos que el stock actual pero solo hasta la fecha de
// corte (inclusive, en día de negocio). Ver docs/DISENO_inventario_a_fecha.md para lo que NO es exacto.
import { diaNegocio } from './fecha-negocio.js';
import type { MovimientosInventario, TransformacionMov } from './movimientos-pantalla.js';

/** Tolerancia en kg para considerar que un saldo es negativo de verdad. */
const UMBRAL_NEGATIVO_KG = 0.005;
const MAX_NOMBRES_AVISO = 3;

/** La fecha de corte efectiva: solo una fecha ANTERIOR a hoy es histórica; hoy, el futuro o nada = stock actual (null). */
export function resolverCorte(al: string | undefined | null, hoy: string): string | null {
  return al && al < hoy ? al : null;
}

export interface EmbalajeConFechas {
  loteId: string;
  almacenId: string | null;
  pesoKg: number;
  marcadoEn: string | null;
  anulado: boolean;
  anuladoEn: string | null;
}

export interface EmbalajeVigente {
  loteId: string;
  almacenId: string | null;
  pesoKg: number;
  anulado: false;
}

/** Embalajes que estaban vigentes al cierre de `corte`: marcados hasta ese día y no anulados a esa fecha. */
export function embalajesVigentesAl(filas: readonly EmbalajeConFechas[], corte: string): EmbalajeVigente[] {
  return filas
    .filter(e => {
      const marcado = diaNegocio(e.marcadoEn);
      if (!marcado || marcado > corte) return false;
      if (!e.anulado) return true;
      const anulado = diaNegocio(e.anuladoEn);
      return anulado !== null && anulado > corte;
    })
    .map(e => ({ loteId: e.loteId, almacenId: e.almacenId, pesoKg: e.pesoKg, anulado: false as const }));
}

type MovimientosFechados = Pick<MovimientosInventario, 'tickets' | 'transformaciones' | 'ajustes'>;

/** Fecha (YYYY-MM-DD) del movimiento más antiguo registrado; null si no hay ninguno. */
export function primerRegistro(mov: MovimientosFechados): string | null {
  const fechas = [
    ...mov.tickets.map(t => t.fecha),
    ...mov.transformaciones.map(t => t.fecha),
    ...mov.ajustes.map(a => a.fecha),
  ].filter((f): f is string => Boolean(f));
  return fechas.length === 0 ? null : fechas.reduce((a, b) => (b < a ? b : a));
}

function transformacionAl(t: TransformacionMov, corte: string, completadoEn: ReadonlyMap<string, string>): TransformacionMov {
  const completada = completadoEn.get(t.id);
  return t.estado === 'completa' && completada && completada > corte ? { ...t, estado: 'bruto' } : t;
}

/**
 * Movimientos con fecha hasta `corte` (inclusive). Una transformación completada después del corte se
 * toma como todavía en proceso ('bruto'): el material estaba retirado y aún no había salido. Devuelve copias.
 */
export function filtrarMovimientosAl(
  mov: MovimientosInventario, corte: string, completadoEn: ReadonlyMap<string, string>
): MovimientosInventario {
  return {
    ...mov,
    tickets: mov.tickets.filter(t => !t.fecha || t.fecha <= corte),
    transformaciones: mov.transformaciones.filter(t => t.fecha <= corte).map(t => transformacionAl(t, corte, completadoEn)),
    ajustes: mov.ajustes.filter(a => a.fecha <= corte),
  };
}

interface AlmacenConSaldo {
  nombre: string;
  grupos: ReadonlyArray<{ articulos: ReadonlyArray<{ nombre: string; stock: number }> }>;
}

export interface EntradaAvisosSaldo {
  corte: string;
  /** Fecha del movimiento más antiguo; null = no hay ninguno; undefined = no se conoce (no se avisa). */
  primerRegistro?: string | null;
  almacenes: ReadonlyArray<AlmacenConSaldo>;
  /** false = no se pudo leer transformaciones.completado_en: sus salidas se fechan con la fecha de la transformación. */
  completadoEnDisponible: boolean;
  /** El usuario pidió valores en dinero (se ocultan: usarían costos de hoy). */
  valorSolicitado: boolean;
}

export const AVISO_SOLO_KILOS = 'Con fecha se muestran solo kilos: los costos y valores usan precios de hoy y no se calculan para una fecha pasada.';

const fechaLegible = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function nombresConSaldoNegativo(almacenes: ReadonlyArray<AlmacenConSaldo>): string[] {
  const nombres = almacenes.flatMap(a =>
    a.grupos.flatMap(g => g.articulos.filter(x => x.stock < -UMBRAL_NEGATIVO_KG).map(x => `${x.nombre} (${a.nombre})`))
  );
  return [...new Set(nombres)];
}

/** Avisos del saldo a una fecha: lo que no se puede dar por exacto (en vez de mostrar un número sin advertencia). */
export function avisosSaldo(e: EntradaAvisosSaldo): string[] {
  const avisos: string[] = [];
  if (e.primerRegistro !== undefined && (e.primerRegistro === null || e.corte < e.primerRegistro)) {
    const desde = e.primerRegistro ? ` (el primer registro es del ${fechaLegible(e.primerRegistro)})` : '';
    avisos.push(`No hay movimientos registrados antes de ${fechaLegible(e.corte)}${desde}: el saldo en 0 es porque el sistema aún no tenía datos, no porque no hubiera material.`);
  }
  const negativos = nombresConSaldoNegativo(e.almacenes);
  if (negativos.length > 0) {
    const lista = negativos.slice(0, MAX_NOMBRES_AVISO).join(', ');
    const mas = negativos.length > MAX_NOMBRES_AVISO ? ` y ${negativos.length - MAX_NOMBRES_AVISO} más` : '';
    avisos.push(`Saldo negativo a esa fecha en ${lista}${mas}: se vendió o transformó antes de que se registrara la entrada; revisa las fechas de esos registros.`);
  }
  if (!e.completadoEnDisponible) {
    avisos.push('No se pudo leer cuándo se completaron las transformaciones: sus kg producidos se cuentan desde la fecha de la transformación.');
  }
  if (e.valorSolicitado) {
    avisos.push(AVISO_SOLO_KILOS);
  }
  return avisos;
}
