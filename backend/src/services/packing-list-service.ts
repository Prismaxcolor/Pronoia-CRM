import { supabaseAdmin } from '../config/supabase.js';
import type {
  EmpresaPackingList,
  IdiomaPackingList,
  PackingListDetalle,
  PackingListItem,
  PackingListResumen,
  ReferenciaPackingList,
  TipoEmbalajePackingList,
} from '../../../shared/types/packing-list.js';
import type { GuardarEmpresaInput, GuardarPackingListInput } from '../schemas/packing-lists.js';
import { calcularNeto, redondear2, totalNeto } from '../utils/packing-list-calculo.js';
import { esObjetoInexistente } from '../utils/migracion-pendiente.js';
import { mensajeDeErrorBd } from '../utils/errores-bd.js';
import { logger } from '../utils/logger.js';
import { nombresDeUsuarios } from './autoria-documento.js';
import { rpcConIdempotencia } from './rpc-idempotente.js';

export const MENSAJE_PACKING_NO_HABILITADO =
  'Esta función aún no está habilitada en la base de datos (falta aplicar migration_packing_list.sql).';
export const MENSAJE_PACKING_NO_LEIDO = 'No se pudo leer el packing list. Intenta de nuevo.';

const COLUMNAS_LISTA =
  'id, contenedor, fecha, tipo_embalaje, es_pcb, descripcion_es, descripcion_en, observaciones_es, observaciones_en, referencia_tipo, referencia_id, creado_por, created_at, updated_at, version';
const COLUMNAS_EMPRESA = 'idioma, nombre, direccion, telefono, email';
const LIMITE_LISTADO = 200;

interface ListaRow {
  id: string;
  contenedor: string;
  fecha: string;
  tipo_embalaje: TipoEmbalajePackingList;
  es_pcb: boolean;
  descripcion_es: string | null;
  descripcion_en: string | null;
  observaciones_es: string | null;
  observaciones_en: string | null;
  referencia_tipo: ReferenciaPackingList | null;
  referencia_id: string | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface ItemRow {
  numero: number;
  numero_paleta: number | null;
  lote: string | null;
  color: string | null;
  peso_bruto: number | string;
  peso_paleta: number | string;
}

type PesosRow = Pick<ItemRow, 'peso_bruto' | 'peso_paleta'>;

interface EmpresaRow {
  idioma: IdiomaPackingList;
  nombre: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

export const MENSAJE_PACKING_CONFLICTO = 'Otra persona modificó este packing list; recarga.';
/** SQLSTATE que lanza guardar_packing_list cuando la versión esperada ya no es la vigente. */
export const CODIGO_CONFLICTO_VERSION = 'PL409';
export const MENSAJE_PACKING_SIN_VERSION = 'Falta la versión del packing list que estás editando; recarga la página.';

export type ResultadoPacking<T> =
  | { ok: true; valor: T }
  | { ok: false; error: string; status: 400 | 404 | 409 | 500 };

function listaToPublico(r: ListaRow, nombres: ReadonlyMap<string, string> = new Map()) {
  return {
    id: r.id,
    contenedor: r.contenedor,
    fecha: r.fecha,
    tipoEmbalaje: r.tipo_embalaje,
    esPcb: r.es_pcb,
    descripcionEs: r.descripcion_es,
    descripcionEn: r.descripcion_en,
    observacionesEs: r.observaciones_es,
    observacionesEn: r.observaciones_en,
    referenciaTipo: r.referencia_tipo,
    referenciaId: r.referencia_id,
    creadoPorNombre: r.creado_por ? (nombres.get(r.creado_por) ?? null) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
  };
}

function itemToPublico(r: ItemRow): PackingListItem {
  const pesoBruto = Number(r.peso_bruto);
  const pesoPaleta = Number(r.peso_paleta);
  return {
    numero: r.numero,
    numeroPaleta: r.numero_paleta,
    lote: r.lote,
    color: r.color,
    pesoBruto,
    pesoPaleta,
    pesoNeto: calcularNeto(pesoBruto, pesoPaleta),
  };
}

export function clasificarError(error: { code?: string; message?: string }): { error: string; status: 400 | 404 | 409 } {
  if (error.code === CODIGO_CONFLICTO_VERSION) return { error: MENSAJE_PACKING_CONFLICTO, status: 409 };
  if (esObjetoInexistente(error)) return { error: MENSAJE_PACKING_NO_HABILITADO, status: 409 };
  const mensaje = mensajeDeErrorBd(error, 'No se pudo guardar el packing list.');
  if (error.code === 'P0001' && /no encontrad/i.test(mensaje)) return { error: mensaje, status: 404 };
  return { error: mensaje, status: 400 };
}

export async function listarPackingLists(): Promise<PackingListResumen[]> {
  const { data, error } = await supabaseAdmin
    .from('packing_lists')
    .select(`${COLUMNAS_LISTA}, packing_list_items(peso_bruto, peso_paleta)`)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(LIMITE_LISTADO);
  if (error) {
    if (esObjetoInexistente(error)) return [];
    logger.error({ evento: 'packing_lists_no_leidos', motivo: error.message });
    throw new Error(MENSAJE_PACKING_NO_LEIDO);
  }
  const filas = (data ?? []) as unknown as Array<ListaRow & { packing_list_items: PesosRow[] }>;
  const nombres = await nombresDeUsuarios(filas.map(f => f.creado_por));
  return filas.map(f => {
    const pesos = f.packing_list_items.map(i => ({ pesoBruto: Number(i.peso_bruto), pesoPaleta: Number(i.peso_paleta) }));
    return { ...listaToPublico(f, nombres), totalBultos: pesos.length, totalNeto: totalNeto(pesos) };
  });
}

export async function obtenerPackingList(id: string): Promise<PackingListDetalle | null> {
  const { data, error } = await supabaseAdmin.from('packing_lists').select(COLUMNAS_LISTA).eq('id', id).maybeSingle();
  if (error) {
    if (esObjetoInexistente(error)) return null;
    logger.error({ evento: 'packing_list_no_leido', packingListId: id, motivo: error.message });
    throw new Error(MENSAJE_PACKING_NO_LEIDO);
  }
  if (!data) return null;
  const { data: items, error: errItems } = await supabaseAdmin
    .from('packing_list_items')
    .select('numero, numero_paleta, lote, color, peso_bruto, peso_paleta')
    .eq('packing_list_id', id)
    .order('orden');
  if (errItems) {
    logger.error({ evento: 'packing_list_items_no_leidos', packingListId: id, motivo: errItems.message });
    throw new Error(MENSAJE_PACKING_NO_LEIDO);
  }
  const fila = data as ListaRow;
  const nombres = await nombresDeUsuarios([fila.creado_por]);
  return { ...listaToPublico(fila, nombres), items: ((items ?? []) as ItemRow[]).map(itemToPublico) };
}

function cabeceraParaRpc(input: GuardarPackingListInput) {
  return {
    contenedor: input.contenedor,
    fecha: input.fecha,
    tipo_embalaje: input.tipoEmbalaje,
    es_pcb: input.esPcb,
    descripcion_es: input.descripcionEs,
    descripcion_en: input.descripcionEn,
    observaciones_es: input.observacionesEs,
    observaciones_en: input.observacionesEn,
    referencia_tipo: input.referenciaTipo,
    referencia_id: input.referenciaId,
  };
}

/** Crea (id null) o actualiza el packing list con todos sus ítems en una sola transacción SQL. */
export async function guardarPackingList(
  id: string | null,
  input: GuardarPackingListInput,
  userId: string
): Promise<ResultadoPacking<PackingListDetalle>> {
  if (id !== null && input.version === undefined) {
    return { ok: false, error: MENSAJE_PACKING_SIN_VERSION, status: 400 };
  }
  const items = input.items.map(i => ({
    numero: i.numero,
    numero_paleta: i.numeroPaleta,
    lote: i.lote,
    color: i.color,
    peso_bruto: redondear2(i.pesoBruto),
    peso_paleta: redondear2(i.pesoPaleta),
  }));
  // Al CREAR con clave, el envoltorio garantiza una sola fila; editar ya lo protege la versión (PL409).
  const { data, error } = id === null && input.clientRequestId
    ? await rpcConIdempotencia({
      clientRequestId: input.clientRequestId,
      capturadoEn: input.capturadoEn,
      envoltorio: 'guardar_packing_list_idem',
      original: 'guardar_packing_list',
      args: { p_id: null, p_cabecera: cabeceraParaRpc(input), p_items: items, p_usuario: userId, p_version_esperada: null },
      // El envoltorio solo crea: no recibe p_id ni la versión.
      omitirEnvoltorio: ['p_id', 'p_version_esperada'],
    })
    : await supabaseAdmin.rpc('guardar_packing_list', {
      p_id: id,
      p_cabecera: cabeceraParaRpc(input),
      p_items: items,
      p_usuario: userId,
      p_version_esperada: id === null ? null : input.version,
    });
  if (error || !data) return { ok: false, ...clasificarError(error ?? { message: 'No se pudo guardar el packing list.' }) };
  const guardadoId = String((data as { id?: string }).id ?? '');
  const detalle = guardadoId ? await obtenerPackingList(guardadoId) : null;
  if (!detalle) return { ok: false, error: 'El packing list se guardó pero no se pudo leer de vuelta.', status: 500 };
  return { ok: true, valor: detalle };
}

export async function eliminarPackingList(id: string): Promise<ResultadoPacking<true>> {
  const { data, error } = await supabaseAdmin.from('packing_lists').delete().eq('id', id).select('id');
  if (error) return { ok: false, ...clasificarError(error) };
  if (!data || data.length === 0) return { ok: false, error: 'Packing list no encontrado.', status: 404 };
  return { ok: true, valor: true };
}

// ---- datos de la empresa por idioma ------------------------------------------

function empresaVacia(idioma: IdiomaPackingList): EmpresaPackingList {
  return { idioma, nombre: null, direccion: null, telefono: null, email: null };
}

/** Siempre devuelve las dos (es, en); si la tabla aún no existe, vacías. */
export async function obtenerEmpresas(): Promise<EmpresaPackingList[]> {
  const { data, error } = await supabaseAdmin.from('packing_list_empresas').select(COLUMNAS_EMPRESA);
  if (error && !esObjetoInexistente(error)) {
    logger.error({ evento: 'packing_empresas_no_leidas', motivo: error.message });
    throw new Error(MENSAJE_PACKING_NO_LEIDO);
  }
  const porIdioma = new Map(((data ?? []) as EmpresaRow[]).map(r => [r.idioma, r as EmpresaPackingList]));
  return (['es', 'en'] as const).map(i => porIdioma.get(i) ?? empresaVacia(i));
}

export async function guardarEmpresa(
  idioma: IdiomaPackingList,
  input: GuardarEmpresaInput,
  userId: string
): Promise<ResultadoPacking<EmpresaPackingList>> {
  const { data, error } = await supabaseAdmin
    .from('packing_list_empresas')
    .upsert(
      { idioma, ...input, actualizado_en: new Date().toISOString(), actualizado_por: userId },
      { onConflict: 'idioma' }
    )
    .select(COLUMNAS_EMPRESA)
    .single();
  if (error || !data) return { ok: false, ...clasificarError(error ?? { message: 'No se pudo guardar.' }) };
  return { ok: true, valor: data as EmpresaPackingList };
}
