import { supabaseAdmin } from '../config/supabase.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import type { CrearBancaInput, ActualizarBancaInput, CrearMovimientoInput } from '../schemas/cochinito.js';

/**
 * Espejo de shared/types/banca.ts y movimiento.ts. Se duplica intencionalmente
 * (ver nota en utils/permisos.ts): @shared no resuelve en runtime con
 * tsx + ESM + extensiones .js.
 */
export type TipoBanca = 'banco_nacional' | 'banco_internacional' | 'exchange' | 'efectivo';
export type TipoMovimiento = 'ingreso' | 'egreso' | 'transferencia';

export interface Banca {
  id: string;
  nombre: string;
  tipo: TipoBanca;
  saldo: number;
  moneda: string;
  descripcion: string;
  archivada: boolean;
  /** Clave de la paleta o hex #RRGGBB; null si la banca no tiene color (o la migración aún no se aplicó). */
  color: string | null;
  /** Chat de Telegram al que van los avisos de esta banca; null = grupo general de cajas. */
  telegramChatId: string | null;
  /** URL pública de la imagen (logo / foto de la caja); null si no tiene (o la migración aún no se aplicó). */
  imagenUrl: string | null;
}

export interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  monto: number;
  moneda: string;
  descripcion: string;
  bancaOrigenId: string;
  bancaDestinoId: string | null;
  fecha: string;
  referencia: string;
  registradoPor: string;
  proveedorId: string | null;
  clienteId: string | null;
  montoUsd: number | null;
  /** Solo transferencias entre monedas distintas: lo que entra a la banca destino. */
  montoDestino: number | null;
  creadoEn: string;
  subtipo: 'pago' | 'adelanto' | 'cobro' | 'anticipo' | null;
  numero: number | null;
  /** Correlativo del sistema (MV-) de un movimiento manual de Wallet; null en pagos/cobros (usan `numero`). */
  numeroSistema: number | null;
  grupoId: string | null;
  comprobantes: string[];
  /** true si el movimiento fue anulado: la fila se conserva, pero ya no cuenta en saldos ni estados de cuenta. */
  anulado: boolean;
  anuladoMotivo: string | null;
  anuladoEn: string | null;
  /** Id de quien anuló (el nombre lo resuelve quien lo muestre). */
  anuladoPor: string | null;
  /** Categoría o subcategoría del Wallet; null = sin categoría (o la migración de categorías aún no se aplicó). */
  categoriaId: string | null;
  /** Transferencia con mesa de cambio: cambista elegido (null en los movimientos normales o si la migración no se aplicó). */
  mesaCambistaId: string | null;
  /** 'en_proceso' = el destino aún no recibió el saldo; 'parcial' = recibió solo una parte; 'completada' = ya se acreditó todo. */
  mesaEstado: 'en_proceso' | 'parcial' | 'completada' | null;
  /** Lo que el cambista debía entregar en el destino (moneda destino), antes de la comisión. */
  mesaMontoBruto: number | null;
  mesaComisionModo: 'porcentaje' | 'monto' | null;
  mesaComisionPct: number | null;
  /** Comisión en la moneda del destino; reduce lo acreditado. */
  mesaComision: number | null;
  /** Neto ya acreditado al destino (moneda destino). Null si no hay mesa o la migración de cobro parcial no se aplicó. */
  mesaMontoCobrado: number | null;
  mesaCompletadaEn: string | null;
  mesaCompletadaPor: string | null;
  /** Comisión bancaria (Bs) cargada a la cuenta junto a este movimiento; null si no lleva (o la migración no se aplicó). */
  comisionBancaria: number | null;
  /** Si es el cargo de una comisión bancaria: id del movimiento al que pertenece; null en los demás. */
  comisionDeId: string | null;
}

function mapBanca(row: Record<string, unknown>): Banca {
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    tipo: (row.tipo as TipoBanca) ?? 'banco_nacional',
    saldo: Number(row.saldo),
    moneda: row.moneda as string,
    descripcion: (row.descripcion as string) ?? '',
    archivada: Boolean(row.archivada),
    color: typeof row.color === 'string' && row.color ? row.color : null,
    telegramChatId: typeof row.telegram_chat_id === 'string' && row.telegram_chat_id ? row.telegram_chat_id : null,
    imagenUrl: typeof row.imagen_url === 'string' && row.imagen_url ? row.imagen_url : null,
  };
}

function mapMovimiento(row: Record<string, unknown>): Movimiento {
  return {
    id: row.id as string,
    tipo: row.tipo as TipoMovimiento,
    monto: Number(row.monto),
    moneda: row.moneda as string,
    descripcion: (row.descripcion as string) ?? '',
    bancaOrigenId: row.banca_origen_id as string,
    bancaDestinoId: (row.banca_destino_id as string) ?? null,
    fecha: row.fecha as string,
    referencia: (row.referencia as string) ?? '',
    registradoPor: (row.registrado_por as string) ?? '',
    proveedorId: (row.proveedor_id as string) ?? null,
    clienteId: (row.cliente_id as string) ?? null,
    montoUsd: row.monto_usd != null ? Number(row.monto_usd) : null,
    montoDestino: row.monto_destino != null ? Number(row.monto_destino) : null,
    creadoEn: row.creado_en as string,
    subtipo: (row.subtipo as Movimiento['subtipo']) ?? null,
    numero: row.numero != null ? Number(row.numero) : null,
    numeroSistema: row.numero_sistema != null ? Number(row.numero_sistema) : null,
    grupoId: (row.grupo_id as string) ?? null,
    comprobantes: Array.isArray(row.comprobantes) ? (row.comprobantes as string[]) : [],
    anulado: Boolean(row.anulado),
    anuladoMotivo: (row.anulado_motivo as string) ?? null,
    anuladoEn: (row.anulado_at as string) ?? null,
    anuladoPor: (row.anulado_por as string) ?? null,
    categoriaId: (row.categoria_id as string) ?? null,
    ...mapMesa(row),
    comisionBancaria: aNumeroONull(row.comision_bancaria),
    comisionDeId: (row.comision_de_id as string) ?? null,
  };
}

const aNumeroONull = (v: unknown): number | null => (v != null ? Number(v) : null);

/** Campos de mesa de cambio; todos null si la fila no los trae (migración sin aplicar o movimiento normal). */
function mapMesa(row: Record<string, unknown>): Pick<Movimiento, 'mesaCambistaId' | 'mesaEstado' | 'mesaMontoBruto' | 'mesaComisionModo' | 'mesaComisionPct' | 'mesaComision' | 'mesaMontoCobrado' | 'mesaCompletadaEn' | 'mesaCompletadaPor'> {
  return {
    mesaCambistaId: (row.mesa_cambista_id as string) ?? null,
    mesaEstado: (row.mesa_estado as Movimiento['mesaEstado']) ?? null,
    mesaMontoBruto: aNumeroONull(row.mesa_monto_bruto),
    mesaComisionModo: (row.mesa_comision_modo as Movimiento['mesaComisionModo']) ?? null,
    mesaComisionPct: aNumeroONull(row.mesa_comision_pct),
    mesaComision: aNumeroONull(row.mesa_comision),
    mesaMontoCobrado: aNumeroONull(row.mesa_monto_cobrado),
    mesaCompletadaEn: (row.mesa_completada_at as string) ?? null,
    mesaCompletadaPor: (row.mesa_completada_por as string) ?? null,
  };
}

export interface ListarBancasOpts {
  incluirArchivadas?: boolean;
}

export async function listarBancas(opts: ListarBancasOpts = {}): Promise<Banca[]> {
  let query = supabaseAdmin.from('bancas').select('*').order('nombre');
  if (!opts.incluirArchivadas) {
    query = query.eq('archivada', false);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(mapBanca);
}

export async function listarMovimientos(): Promise<Movimiento[]> {
  const { data, error } = await supabaseAdmin
    .from('movimientos')
    .select('*')
    .order('creado_en', { ascending: false });

  if (error || !data) return [];
  return data.map(mapMovimiento);
}

/** Un movimiento por id (null si no existe o la BD falla). */
export async function obtenerMovimiento(id: string): Promise<Movimiento | null> {
  const { data, error } = await supabaseAdmin.from('movimientos').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return mapMovimiento(data);
}

export interface DetalleMovimiento {
  movimiento: Movimiento;
  bancaOrigenNombre: string | null;
  bancaDestinoNombre: string | null;
  /** Solo si quien consulta puede ver proveedores / clientes (si no, null). */
  proveedorNombre: string | null;
  clienteNombre: string | null;
  /** Cambista de una transferencia con mesa de cambio; solo si quien consulta puede ver la mesa (si no, null). */
  cambistaNombre: string | null;
  registradoPorNombre: string | null;
  anuladoPorNombre: string | null;
}

export interface OpcionesDetalleMovimiento {
  verProveedores: boolean;
  verClientes: boolean;
  verCambistas?: boolean;
}

/** Nombre por id en una tabla con columna `nombre` (null si no hay id o no existe). */
async function nombreDe(tabla: 'bancas' | 'proveedores' | 'clientes' | 'cambistas' | 'users', id: string | null): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabaseAdmin.from(tabla).select('nombre').eq('id', id).maybeSingle();
  return (data as { nombre: string } | null)?.nombre ?? null;
}

/** Un movimiento con los nombres ya resueltos (bancas, tercero, quién lo registró y quién lo anuló). null si no existe. */
export async function obtenerDetalleMovimiento(id: string, opts: OpcionesDetalleMovimiento): Promise<DetalleMovimiento | null> {
  const movimiento = await obtenerMovimiento(id);
  if (!movimiento) return null;
  const [bancaOrigenNombre, bancaDestinoNombre, proveedorNombre, clienteNombre, cambistaNombre, registradoPorNombre, anuladoPorNombre] = await Promise.all([
    nombreDe('bancas', movimiento.bancaOrigenId),
    nombreDe('bancas', movimiento.bancaDestinoId),
    opts.verProveedores ? nombreDe('proveedores', movimiento.proveedorId) : Promise.resolve(null),
    opts.verClientes ? nombreDe('clientes', movimiento.clienteId) : Promise.resolve(null),
    opts.verCambistas ? nombreDe('cambistas', movimiento.mesaCambistaId) : Promise.resolve(null),
    nombreDe('users', movimiento.registradoPor || null),
    nombreDe('users', movimiento.anuladoPor),
  ]);
  return { movimiento, bancaOrigenNombre, bancaDestinoNombre, proveedorNombre, clienteNombre, cambistaNombre, registradoPorNombre, anuladoPorNombre };
}

/** Campos opcionales de bancas que dependen de una migración: si la columna falta se degrada sin ellos. */
type CamposBanca = { color?: unknown; telegramChatId?: unknown; imagenUrl?: unknown };

/** Pasa los campos del schema a columnas de BD (telegramChatId -> telegram_chat_id, imagenUrl -> imagen_url). */
function aColumnas<T extends CamposBanca>(campos: T): Record<string, unknown> {
  const { telegramChatId, imagenUrl, ...resto } = campos;
  return {
    ...resto,
    ...(telegramChatId === undefined ? {} : { telegram_chat_id: telegramChatId }),
    ...(imagenUrl === undefined ? {} : { imagen_url: imagenUrl }),
  };
}

const COLUMNAS_OPCIONALES = ['color', 'telegram_chat_id', 'imagen_url'] as const;

export const MENSAJE_TELEGRAM_BANCA_PENDIENTE =
  'El grupo de Telegram por cuenta aún no está habilitado en la base de datos (falta aplicar migration_bancas_telegram_chat.sql). Guarda sin grupo o aplica la migración.';

export const MENSAJE_IMAGEN_BANCA_PENDIENTE =
  'La imagen por cuenta aún no está habilitada en la base de datos (falta aplicar migration_bancas_imagen.sql). Guarda sin imagen o aplica la migración.';

/** Columnas que no se descartan en silencio si faltan y se intentaba guardar un valor, con su mensaje. */
const MENSAJE_PENDIENTE_POR_COLUMNA: Readonly<Record<string, string>> = {
  telegram_chat_id: MENSAJE_TELEGRAM_BANCA_PENDIENTE,
  imagen_url: MENSAJE_IMAGEN_BANCA_PENDIENTE,
};

/** Mensaje de "migración pendiente" si alguna columna faltante tenía un valor que guardar; undefined si no. */
function pendienteDe(faltan: readonly string[], columnas: Record<string, unknown>): string | undefined {
  const columna = faltan.find(c => c in MENSAJE_PENDIENTE_POR_COLUMNA && columnas[c] != null);
  return columna ? MENSAJE_PENDIENTE_POR_COLUMNA[columna] : undefined;
}

const usaColumnasOpcionales = (c: Record<string, unknown>): boolean => COLUMNAS_OPCIONALES.some(k => k in c);

/** Columnas opcionales que cita un error de "columna inexistente"; si no cita ninguna, se asumen todas. */
function columnasFaltantes(error: { message?: string }): string[] {
  const citadas = COLUMNAS_OPCIONALES.filter(c => (error.message ?? '').includes(c));
  return citadas.length > 0 ? citadas : [...COLUMNAS_OPCIONALES];
}

function sinColumnas(columnas: Record<string, unknown>, quitar: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(columnas).filter(([k]) => !quitar.includes(k)));
}

type RespEscritura = { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
type ResultadoEscritura = RespEscritura | { pendiente: true; mensaje: string };

/**
 * Ejecuta la escritura degradando POR COLUMNA si una migración opcional falta (color / telegram_chat_id / imagen_url).
 * Si falta telegram_chat_id o imagen_url y se intentaba guardar un valor, no se descarta en silencio: pendiente => 409.
 * (Guardar null sí se descarta: no hay nada que limpiar en una columna que no existe.)
 */
async function escribirDegradando(
  columnas: Record<string, unknown>,
  ejecutar: (c: Record<string, unknown>) => PromiseLike<RespEscritura>
): Promise<ResultadoEscritura> {
  let actuales = columnas;
  for (let intento = 0; intento <= COLUMNAS_OPCIONALES.length; intento++) {
    const resp = await ejecutar(actuales);
    if (!resp.error || !esObjetoInexistente(resp.error) || !usaColumnasOpcionales(actuales)) return resp;
    const faltan = columnasFaltantes(resp.error).filter(c => c in actuales);
    if (faltan.length === 0) return resp;
    const mensaje = pendienteDe(faltan, actuales);
    if (mensaje) return { pendiente: true, mensaje };
    actuales = sinColumnas(actuales, faltan);
  }
  return ejecutar(actuales);
}

export type ResultadoBanca = { banca: Banca } | { error: string; pendiente?: boolean };

export async function crearBanca(input: CrearBancaInput): Promise<ResultadoBanca> {
  const base = { nombre: input.nombre, tipo: input.tipo, moneda: input.moneda, descripcion: input.descripcion, saldo: 0 };
  // Solo lo que venga: una banca sin color ni grupo no depende de las columnas opcionales.
  const completo: Record<string, unknown> = {
    ...base,
    ...(input.color ? { color: input.color } : {}),
    ...(input.telegramChatId ? { telegram_chat_id: input.telegramChatId } : {}),
    ...(input.imagenUrl ? { imagen_url: input.imagenUrl } : {}),
  };
  const r = await escribirDegradando(completo, c => supabaseAdmin.from('bancas').insert(c).select().single());
  if ('pendiente' in r) return { error: r.mensaje, pendiente: true };
  if (r.error || !r.data) return { error: r.error?.message ?? 'No se pudo crear la banca.' };
  return { banca: mapBanca(r.data) };
}

/** Grupo de Telegram actual de una banca (para auditar cambios). null si no tiene, no existe o la columna falta. */
export async function leerTelegramChatIdBanca(id: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('bancas').select('telegram_chat_id').eq('id', id).maybeSingle();
  const valor = (data as { telegram_chat_id?: string | null } | null)?.telegram_chat_id;
  return typeof valor === 'string' && valor ? valor : null;
}

export async function actualizarBanca(id: string, campos: ActualizarBancaInput): Promise<ResultadoBanca> {
  const r = await escribirDegradando(aColumnas(campos), c =>
    supabaseAdmin.from('bancas').update(c).eq('id', id).select().maybeSingle()
  );
  if ('pendiente' in r) return { error: r.mensaje, pendiente: true };
  if (r.error) return { error: r.error.message };
  if (!r.data) return { error: 'Banca no encontrada.' };
  return { banca: mapBanca(r.data) };
}

export interface ArchivarBancaResult {
  ok: boolean;
  razon?: string;
}

/**
 * Archiva una banca (soft delete). El saldo se lee de la BD (no del cliente)
 * para no depender de un valor que el frontend podría enviar desactualizado.
 * No se permite borrar físicamente: regla de dominio del CLAUDE.md — "en
 * finanzas NUNCA se borra; se reversa con un movimiento contrario".
 */
export async function archivarBanca(id: string): Promise<ArchivarBancaResult> {
  const { data: banca, error: errLectura } = await supabaseAdmin
    .from('bancas')
    .select('saldo')
    .eq('id', id)
    .maybeSingle();

  if (errLectura || !banca) return { ok: false, razon: 'Banca no encontrada.' };
  if (Math.abs(Number(banca.saldo)) > 0.001) {
    return {
      ok: false,
      razon: 'No se puede archivar una banca con saldo distinto de 0. Transfiere o retira los fondos primero.',
    };
  }

  const { error } = await supabaseAdmin
    .from('bancas')
    .update({ archivada: true, archivada_en: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, razon: error.message };
  return { ok: true };
}

export async function desarchivarBanca(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('bancas')
    .update({ archivada: false, archivada_en: null })
    .eq('id', id);
  return !error;
}

/** Crea un movimiento de ingreso, egreso o transferencia. El trigger SQL ajusta el saldo. */
export async function crearMovimiento(
  input: CrearMovimientoInput,
  registradoPor: string
): Promise<{ movimiento: Movimiento } | { error: string }> {
  const esTransferencia = input.tipo === 'transferencia';
  const { data, error } = await supabaseAdmin
    .from('movimientos')
    .insert({
      tipo: input.tipo,
      monto: input.monto,
      monto_destino: esTransferencia ? (input.montoDestino ?? null) : null,
      moneda: input.moneda,
      descripcion: input.descripcion,
      banca_origen_id: input.bancaId,
      banca_destino_id: esTransferencia ? input.bancaDestinoId : null,
      fecha: input.fecha,
      referencia: input.referencia,
      registrado_por: registradoPor,
      proveedor_id: input.proveedorId ?? null,
      cliente_id: input.clienteId ?? null,
      // Solo si hay comprobante: así un movimiento sin imagen no depende de la columna.
      ...(input.comprobantes.length > 0 ? { comprobantes: input.comprobantes } : {}),
      // Solo si hay categoría: un movimiento sin categoría no depende de la columna.
      ...(input.categoriaId ? { categoria_id: input.categoriaId } : {}),
    })
    .select()
    .single();

  if (error || !data) return { error: error?.message ?? 'No se pudo registrar el movimiento.' };
  return { movimiento: mapMovimiento(data) };
}
