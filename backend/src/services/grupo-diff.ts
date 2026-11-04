import { sanitizarValor } from '../utils/grupo-formato.js';

/**
 * Diff ANTES/DESPUÉS de un maestro editado, para el aviso al grupo de Telegram. Función pura.
 *
 * Solo se listan los campos que realmente cambiaron. Por seguridad cada campo declara si su
 * valor puede mostrarse (`mostrar`): solo los cortos y no sensibles (nombre, activo, tipo,
 * categoría, moneda, estado...). Documento, teléfono, correo, dirección, notas, cuentas, fotos
 * y todo lo de usuarios salen únicamente como "<campo> modificado", jamás con el valor.
 */

export type TablaDiff =
  | 'proveedores' | 'clientes' | 'productos' | 'almacenes' | 'vehiculos' | 'taras' | 'lotes'
  | 'listas_precios' | 'tipos_material' | 'users';

type TipoCampo = 'texto' | 'numero' | 'bool' | 'lista' | 'json';

interface CampoDiff {
  /** Columna de la tabla. */
  col: string;
  /** Nombre legible que sale en el mensaje. */
  rotulo: string;
  tipo: TipoCampo;
  /** true: se muestra "antes → después". Por defecto solo el nombre del campo. */
  mostrar?: boolean;
}

const MAX_VALOR_CAMBIO = 40;
const MAX_LINEAS = 12;

const t = (col: string, rotulo: string, mostrar = false): CampoDiff => ({ col, rotulo, tipo: 'texto', mostrar });
const activo: CampoDiff = { col: 'activo', rotulo: 'activo', tipo: 'bool', mostrar: true };
const fotos: CampoDiff = { col: 'fotos', rotulo: 'fotos', tipo: 'lista' };

export const CAMPOS_DIFF: Readonly<Record<TablaDiff, ReadonlyArray<CampoDiff>>> = {
  proveedores: [t('nombre', 'nombre', true), t('rfc', 'documento (cédula/RIF)'), t('telefono', 'teléfono'), t('email', 'correo'), activo, fotos],
  clientes: [
    t('nombre', 'nombre', true), t('identificacion', 'documento (cédula/RIF)'), t('telefono', 'teléfono'), t('email', 'correo'),
    t('direccion', 'dirección'), t('notas', 'notas'), activo, fotos,
  ],
  productos: [
    t('nombre', 'nombre', true), t('descripcion', 'descripción'), t('categoria', 'categoría', true), t('tipo', 'tipo', true),
    t('moneda', 'moneda', true), t('tipo_material_id', 'categoría de material'),
    { col: 'peso', rotulo: 'peso', tipo: 'numero' }, { col: 'costo_unitario', rotulo: 'costo', tipo: 'numero' },
    { col: 'variantes', rotulo: 'variantes', tipo: 'json' }, { col: 'sub_productos', rotulo: 'sub-productos', tipo: 'json' },
    activo, fotos,
  ],
  almacenes: [
    t('nombre', 'nombre', true), t('detalle', 'detalle'), activo,
    { col: 'es_predeterminado', rotulo: 'predeterminado', tipo: 'bool', mostrar: true }, fotos,
  ],
  vehiculos: [
    t('nombre', 'nombre', true), t('placa', 'placa'), t('descripcion', 'descripción'), t('marca', 'marca', true),
    t('modelo', 'modelo', true), t('color', 'color', true), t('conductor', 'conductor'), activo, fotos,
  ],
  taras: [t('nombre', 'nombre', true), { col: 'peso', rotulo: 'peso', tipo: 'numero', mostrar: true }, activo, fotos],
  lotes: [t('nombre', 'nombre', true), { col: 'composicion', rotulo: 'composición', tipo: 'json' }, activo, fotos],
  listas_precios: [t('nombre', 'nombre', true), t('tipo', 'tipo', true), t('vigente_desde', 'vigente desde', true), activo],
  tipos_material: [
    t('nombre', 'nombre', true), t('descripcion', 'descripción'), activo,
    { col: 'sin_lote', rotulo: 'sin lote', tipo: 'bool', mostrar: true },
  ],
  // Usuarios: jamás password/hash/tokens (ni siquiera se consultan). Solo nombres de campo, salvo rol/activo.
  users: [
    t('nombre', 'nombre'), t('email', 'correo'), t('rol', 'rol', true), { col: 'permisos', rotulo: 'permisos', tipo: 'lista' }, activo,
  ],
};

export function esTablaDiff(tabla: string | undefined): tabla is TablaDiff {
  return tabla !== undefined && Object.prototype.hasOwnProperty.call(CAMPOS_DIFF, tabla);
}

/** Columnas a consultar (una sola consulta por id). */
export function columnasDiff(tabla: TablaDiff): string {
  return CAMPOS_DIFF[tabla].map(c => c.col).join(', ');
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

const vacio = (v: unknown): boolean => v === null || v === undefined;

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)]));
  }
  return v;
}

const esVacioEstructura = (v: unknown): boolean =>
  Array.isArray(v) ? v.length === 0 : !!v && typeof v === 'object' && Object.keys(v).length === 0;

function normalizarTexto(v: unknown): string | null {
  if (vacio(v)) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

/** Forma comparable de un valor: null y '' son lo mismo; números como string; arreglos por contenido. */
export function normalizarCampo(v: unknown, tipo: TipoCampo): string | null {
  switch (tipo) {
    case 'bool':
      return v === true || v === 'true' || v === 1 ? 'true' : 'false';
    case 'numero': {
      const s = normalizarTexto(v);
      if (s === null) return null;
      const n = Number(s);
      return Number.isFinite(n) ? String(n) : s;
    }
    case 'lista': {
      if (vacio(v) || esVacioEstructura(v)) return null;
      if (!Array.isArray(v)) return normalizarTexto(v);
      const items = v.map(x => JSON.stringify(canonico(typeof x === 'string' ? x.trim() : x))).sort();
      return JSON.stringify(items);
    }
    case 'json':
      return vacio(v) || esVacioEstructura(v) ? null : JSON.stringify(canonico(v));
    default:
      return normalizarTexto(v);
  }
}

function valorLegible(v: unknown, tipo: TipoCampo): string {
  if (tipo === 'bool') return normalizarCampo(v, 'bool') === 'true' ? 'sí' : 'no';
  const n = normalizarCampo(v, tipo);
  if (n === null) return '—';
  const corto = n.length > MAX_VALOR_CAMBIO ? `${n.slice(0, MAX_VALOR_CAMBIO - 1)}…` : n;
  return sanitizarValor(corto);
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

type Fila = Readonly<Record<string, unknown>>;

/** Líneas "• campo ..." de los campos que cambiaron. Vacío si no cambió nada real. */
export function lineasDeCambios(tabla: TablaDiff, antes: Fila, despues: Fila): string[] {
  const lineas = CAMPOS_DIFF[tabla].flatMap(c => {
    if (normalizarCampo(antes[c.col], c.tipo) === normalizarCampo(despues[c.col], c.tipo)) return [];
    return c.mostrar
      ? [`• ${c.rotulo}: ${valorLegible(antes[c.col], c.tipo)} → ${valorLegible(despues[c.col], c.tipo)}`]
      : [`• ${c.rotulo} modificado`];
  });
  return lineas.length > MAX_LINEAS ? [...lineas.slice(0, MAX_LINEAS), `• … y ${lineas.length - MAX_LINEAS} más`] : lineas;
}

/**
 * Detalles del aviso de edición: ['Cambió:', '• ...'] o [] si no cambió nada.
 * `extra` permite añadir cambios que no se leen de la fila (p. ej. contraseña restablecida).
 */
export function detallesDeCambios(tabla: TablaDiff, antes: Fila, despues: Fila, extra: ReadonlyArray<string> = []): string[] {
  const lineas = [...lineasDeCambios(tabla, antes, despues), ...extra];
  return lineas.length > 0 ? ['Cambió:', ...lineas] : [];
}
