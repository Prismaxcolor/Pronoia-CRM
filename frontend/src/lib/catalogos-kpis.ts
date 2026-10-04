/** Lógica pura de las pantallas de catálogos (Taras, Vehículos, Citas, Usuarios). Sin React: se prueba desde
 *  backend/tests/catalogos-kpis.test.ts. Todo devuelve valores NUEVOS (nunca muta la entrada). */

/** Minúsculas y sin tildes, para buscar "camion" y encontrar "Camión". */
export function normalizarTexto(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** true si TODAS las palabras de `consulta` aparecen en alguno de los textos. Consulta vacía = coincide. */
export function coincideTexto(textos: ReadonlyArray<string | null | undefined>, consulta: string | undefined): boolean {
  const palabras = normalizarTexto(consulta ?? '').split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return true;
  const pajar = normalizarTexto(textos.filter(Boolean).join(' '));
  return palabras.every(p => pajar.includes(p));
}

export type FiltroActivo = 'activos' | 'inactivos';

export function coincideEstadoActivo(activo: boolean, filtro: string | undefined): boolean {
  if (filtro === 'activos') return activo;
  if (filtro === 'inactivos') return !activo;
  return true;
}

/* ---------- Taras ---------- */

export interface KpisTaras {
  total: number;
  activas: number;
  inactivas: number;
  /** Sobre las taras ACTIVAS; null si no hay ninguna. */
  pesoMin: number | null;
  pesoMax: number | null;
}

export function kpisTaras(taras: ReadonlyArray<{ peso: number; activo: boolean }>): KpisTaras {
  const activas = taras.filter(t => t.activo);
  const pesos = activas.map(t => t.peso).filter(Number.isFinite);
  return {
    total: taras.length,
    activas: activas.length,
    inactivas: taras.length - activas.length,
    pesoMin: pesos.length ? Math.min(...pesos) : null,
    pesoMax: pesos.length ? Math.max(...pesos) : null,
  };
}

/* ---------- Vehículos ---------- */

export interface KpisVehiculos {
  total: number;
  activos: number;
  inactivos: number;
  sinFoto: number;
  sinPlaca: number;
}

export function kpisVehiculos(vehiculos: ReadonlyArray<{ activo: boolean; fotos: readonly string[]; placa: string | null }>): KpisVehiculos {
  const activos = vehiculos.filter(v => v.activo).length;
  return {
    total: vehiculos.length,
    activos,
    inactivos: vehiculos.length - activos,
    sinFoto: vehiculos.filter(v => v.fotos.length === 0).length,
    sinPlaca: vehiculos.filter(v => !v.placa).length,
  };
}

/* ---------- Citas ---------- */

export interface CitaBasica { fecha: string; estado: string }

export interface KpisCitas {
  hoy: number;
  proximos7: number;
  pendientes: number;
}

const ESTADOS_INACTIVOS = ['cancelada', 'completada'];

/** Suma días a una fecha ISO (yyyy-mm-dd) en UTC, sin corrimiento por zona horaria. */
export function sumarDiasIso(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Citas "vivas" (ni canceladas ni completadas) de hoy, de los próximos 7 días (hoy incluido) y pendientes de confirmar
 *  desde hoy en adelante. Las citas anteriores a hoy no cuentan. */
export function kpisCitas(citas: readonly CitaBasica[], hoyIso: string): KpisCitas {
  const limite = sumarDiasIso(hoyIso, 6);
  const vivas = citas.filter(c => c.fecha >= hoyIso && !ESTADOS_INACTIVOS.includes(c.estado));
  return {
    hoy: vivas.filter(c => c.fecha === hoyIso).length,
    proximos7: vivas.filter(c => c.fecha <= limite).length,
    pendientes: vivas.filter(c => c.estado === 'pendiente').length,
  };
}

/* ---------- Usuarios ---------- */

export interface KpisUsuarios {
  total: number;
  activos: number;
  inactivos: number;
  /** Activos por rol. */
  activosPorRol: Record<string, number>;
}

export function kpisUsuarios(usuarios: ReadonlyArray<{ rol: string; activo: boolean }>): KpisUsuarios {
  const activosPorRol: Record<string, number> = { superadmin: 0, administracion: 0, trabajador: 0 };
  for (const u of usuarios) {
    if (u.activo) activosPorRol[u.rol] = (activosPorRol[u.rol] ?? 0) + 1;
  }
  const activos = usuarios.filter(u => u.activo).length;
  return { total: usuarios.length, activos, inactivos: usuarios.length - activos, activosPorRol };
}
