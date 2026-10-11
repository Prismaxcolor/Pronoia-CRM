import { supabaseAdmin } from '../config/supabase.js';
import type {
  EmpresaPackingList,
  FotoPaletaPacking,
  IdiomaPackingList,
  PackingListDetalle,
  PackingListItem,
  PackingListResumen,
  ProyeccionLotePacking,
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
import { borrarFotosSinReferencia, firmarFotosPacking, leerFotosGuardadas } from './packing-list-fotos-service.js';

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

/** Opciones de lectura/escritura que dependen de quién pide: la proyección es un dato de valor. */
export interface OpcionesValores {
  /** facturacion:ver. Por defecto false: la proyección ni se lee, ni se devuelve, ni se escribe. */
  puedeVerValores?: boolean;
  /** productos:ver (inventario) o facturacion:ver. Por defecto false: el almacén y las fotos de las paletas
   *  (control interno) ni se leen, ni se devuelven, ni se escriben (la BD conserva lo guardado). */
  puedeVerControl?: boolean;
}

interface LineaProyeccionRow {
  lote: string;
  valor_kg_usd?: number | string | null;
  valor_real_kg_usd?: number | string | null;
}

interface ItemRow {
  numero: number;
  numero_paleta: number | null;
  lote: string | null;
  color: string | null;
  peso_bruto: number | string;
  peso_paleta: number | string;
  /** Columnas de migration_packing_list_lote_fotos.sql: ausentes hasta aplicarla. */
  almacen_id?: string | null;
  fotos?: string[] | null;
}

type PesosRow = Pick<ItemRow, 'peso_bruto' | 'peso_paleta'>;

interface EmpresaRow {
  idioma: IdiomaPackingList;
  nombre: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
}

export const MENSAJE_CLIENTE_NO_INTERNACIONAL = 'El cliente elegido no es un cliente internacional.';
export const MENSAJE_CLIENTE_NO_ENCONTRADO = 'El cliente elegido no existe.';
export const MENSAJE_CLIENTE_NO_HABILITADO =
  'Vincular un cliente aún no está habilitado en la base de datos (falta aplicar migration_packing_list_cliente_resultados.sql).';
export const MENSAJE_LOTE_FOTOS_NO_HABILITADO =
  'Guardar el almacén o las fotos de las paletas aún no está habilitado en la base de datos (falta aplicar migration_packing_list_lote_fotos.sql).';
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

interface ExtrasItems {
  almacenes: ReadonlyMap<string, string>;
  urls: ReadonlyMap<string, string | null>;
}

const SIN_EXTRAS: ExtrasItems = { almacenes: new Map(), urls: new Map() };

/** Con `extras` null no se devuelve el control interno (almacén y fotos): el usuario no tiene permiso de inventario. */
function itemToPublico(r: ItemRow, extras: ExtrasItems | null = SIN_EXTRAS): PackingListItem {
  const pesoBruto = Number(r.peso_bruto);
  const pesoPaleta = Number(r.peso_paleta);
  const base = {
    numero: r.numero,
    numeroPaleta: r.numero_paleta,
    lote: r.lote,
    color: r.color,
    pesoBruto,
    pesoPaleta,
    pesoNeto: calcularNeto(pesoBruto, pesoPaleta),
  };
  if (!extras) return base;
  const fotos: FotoPaletaPacking[] = (r.fotos ?? []).map(ruta => ({ ruta, url: extras.urls.get(ruta) ?? null }));
  return {
    ...base,
    almacenId: r.almacen_id ?? null,
    almacenNombre: r.almacen_id ? (extras.almacenes.get(r.almacen_id) ?? null) : null,
    fotos,
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

const numeroOnull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

/** El valor real solo viaja cuando existe: así una línea sin resultados conserva su forma anterior. */
const proyeccionToPublica = (filas: readonly LineaProyeccionRow[] | null | undefined): ProyeccionLotePacking[] =>
  (filas ?? []).map(l => {
    const real = numeroOnull(l.valor_real_kg_usd);
    return { lote: l.lote, valorKgUsd: numeroOnull(l.valor_kg_usd), ...(real === null ? {} : { valorRealKgUsd: real }) };
  });

/**
 * Lee la cabecera. Cada migración añade una columna: se prueba con todas las que corresponden y, si alguna aún
 * no existe, se reintenta sin la más nueva hasta dar con un conjunto que la BD acepte.
 */
async function leerCabecera(id: string, conValores: boolean) {
  const candidatos = [
    ...(conValores ? [`${COLUMNAS_LISTA}, cliente_id, proyeccion`, `${COLUMNAS_LISTA}, proyeccion`] : []),
    `${COLUMNAS_LISTA}, cliente_id`,
    COLUMNAS_LISTA,
  ];
  let ultimo = await supabaseAdmin.from('packing_lists').select(candidatos[0]).eq('id', id).maybeSingle();
  for (const columnas of candidatos.slice(1)) {
    if (!ultimo.error || !esObjetoInexistente(ultimo.error)) break;
    ultimo = await supabaseAdmin.from('packing_lists').select(columnas).eq('id', id).maybeSingle();
  }
  return ultimo;
}

/** Nombre del cliente vinculado (mejor esfuerzo: si no se puede leer, el detalle sigue con el id). */
async function nombreDeCliente(clienteId: string | null | undefined): Promise<string | null> {
  if (!clienteId) return null;
  const { data } = await supabaseAdmin.from('clientes').select('nombre').eq('id', clienteId).maybeSingle();
  return (data as { nombre?: string } | null)?.nombre ?? null;
}

const COLUMNAS_ITEM = 'numero, numero_paleta, lote, color, peso_bruto, peso_paleta';
const COLUMNAS_ITEM_CONTROL = `${COLUMNAS_ITEM}, almacen_id, fotos`;

/** Ítems del packing list. Si la migración de almacén/fotos aún no está aplicada, se leen sin esas columnas. */
async function leerItems(id: string, incluirControl: boolean) {
  const consulta = (columnas: string) =>
    supabaseAdmin.from('packing_list_items').select(columnas).eq('packing_list_id', id).order('orden');
  if (!incluirControl) return consulta(COLUMNAS_ITEM);
  const conControl = await consulta(COLUMNAS_ITEM_CONTROL);
  if (!conControl.error || !esObjetoInexistente(conControl.error)) return conControl;
  return consulta(COLUMNAS_ITEM);
}

async function nombresDeAlmacenes(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('almacenes').select('id, nombre').in('id', [...ids]);
  return new Map(((data ?? []) as Array<{ id: string; nombre: string }>).map(a => [a.id, a.nombre] as const));
}

/** Nombres de almacén y URLs firmadas de las fotos (mejor esfuerzo: sin ellos el detalle sigue con ids y rutas). */
async function extrasDeItems(items: readonly ItemRow[]): Promise<ExtrasItems> {
  const idsAlmacen = [...new Set(items.flatMap(i => (i.almacen_id ? [i.almacen_id] : [])))];
  const [almacenes, urls] = await Promise.all([
    nombresDeAlmacenes(idsAlmacen),
    firmarFotosPacking(items.flatMap(i => i.fotos ?? [])),
  ]);
  return { almacenes, urls };
}

export async function obtenerPackingList(id: string, opciones: OpcionesValores = {}): Promise<PackingListDetalle | null> {
  const conValores = opciones.puedeVerValores === true;
  const conControl = opciones.puedeVerControl === true;
  const { data, error } = await leerCabecera(id, conValores);
  if (error) {
    if (esObjetoInexistente(error)) return null;
    logger.error({ evento: 'packing_list_no_leido', packingListId: id, motivo: error.message });
    throw new Error(MENSAJE_PACKING_NO_LEIDO);
  }
  if (!data) return null;
  const { data: items, error: errItems } = await leerItems(id, conControl);
  if (errItems) {
    logger.error({ evento: 'packing_list_items_no_leidos', packingListId: id, motivo: errItems.message });
    throw new Error(MENSAJE_PACKING_NO_LEIDO);
  }
  const filasItems = (items ?? []) as unknown as ItemRow[];
  const extras = conControl ? await extrasDeItems(filasItems) : null;
  const fila = data as unknown as ListaRow & { proyeccion?: LineaProyeccionRow[] | null; cliente_id?: string | null };
  const nombres = await nombresDeUsuarios([fila.creado_por]);
  const detalle = {
    ...listaToPublico(fila, nombres),
    clienteId: fila.cliente_id ?? null,
    clienteNombre: await nombreDeCliente(fila.cliente_id),
    items: filasItems.map(i => itemToPublico(i, extras)),
  };
  return conValores ? { ...detalle, proyeccion: proyeccionToPublica(fila.proyeccion) } : detalle;
}

type LineaProyeccionInput = NonNullable<GuardarPackingListInput['proyeccion']>[number];

const lineaProyeccionParaRpc = (l: LineaProyeccionInput) => ({
  lote: l.lote,
  ...(l.valorKgUsd == null ? {} : { valor_kg_usd: l.valorKgUsd }),
  ...(l.valorRealKgUsd == null ? {} : { valor_real_kg_usd: l.valorRealKgUsd }),
});

/** La clave `proyeccion` solo viaja si el usuario ve valores Y la mandó: ausente, la BD conserva lo guardado. */
function cabeceraParaRpc(input: GuardarPackingListInput, puedeVerValores: boolean) {
  const proyeccion = puedeVerValores && input.proyeccion
    ? { proyeccion: input.proyeccion.map(lineaProyeccionParaRpc) }
    : {};
  // Ausente = la BD conserva el cliente; null = desvincula.
  const cliente = input.clienteId === undefined ? {} : { cliente_id: input.clienteId };
  return {
    ...proyeccion,
    ...cliente,
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

/**
 * Comprueba que el cliente exista y sea internacional, y que la columna cliente_id ya exista:
 * la función SQL anterior ignora en silencio claves desconocidas, así que sin esta guarda el vínculo se perdería.
 */
async function validarClienteInternacional(clienteId: string): Promise<{ ok: true } | { ok: false; error: string; status: 400 | 409 }> {
  const sonda = await supabaseAdmin.from('packing_lists').select('cliente_id').limit(1);
  if (sonda.error) {
    return esObjetoInexistente(sonda.error)
      ? { ok: false, error: MENSAJE_CLIENTE_NO_HABILITADO, status: 409 }
      : { ok: false, error: MENSAJE_PACKING_NO_LEIDO, status: 400 };
  }
  const { data, error } = await supabaseAdmin.from('clientes').select('id, nombre, tipo_venta').eq('id', clienteId).maybeSingle();
  if (error) return { ok: false, error: MENSAJE_PACKING_NO_LEIDO, status: 400 };
  if (!data) return { ok: false, error: MENSAJE_CLIENTE_NO_ENCONTRADO, status: 400 };
  if ((data as { tipo_venta?: string | null }).tipo_venta !== 'internacional') {
    return { ok: false, error: MENSAJE_CLIENTE_NO_INTERNACIONAL, status: 400 };
  }
  return { ok: true };
}

type ItemInput = GuardarPackingListInput['items'][number];

/** Almacén o fotos presentes en el ítem (la función SQL anterior los ignoraría en silencio). */
const usaControlInterno = (i: ItemInput): boolean => Boolean(i.almacenId) || (i.fotos?.length ?? 0) > 0;

/**
 * almacen_id/fotos solo viajan si el cliente los mandó Y el usuario ve el control interno: ausentes, la BD conserva lo
 * guardado de esa paleta (así quien no tiene el permiso no puede borrar ni cambiar fotos/almacén que no ve).
 */
const itemParaRpc = (i: ItemInput, conControl: boolean) => ({
  numero: i.numero,
  numero_paleta: i.numeroPaleta,
  lote: i.lote,
  color: i.color,
  peso_bruto: redondear2(i.pesoBruto),
  peso_paleta: redondear2(i.pesoPaleta),
  ...(!conControl || i.almacenId === undefined ? {} : { almacen_id: i.almacenId }),
  ...(!conControl || i.fotos === undefined ? {} : { fotos: i.fotos }),
});

/** True si packing_list_items ya tiene almacen_id y fotos (migration_packing_list_lote_fotos.sql). */
async function migracionLoteFotosAplicada(): Promise<boolean> {
  const sonda = await supabaseAdmin.from('packing_list_items').select('almacen_id, fotos').limit(1);
  return !sonda.error;
}

/** Crea (id null) o actualiza el packing list con todos sus ítems en una sola transacción SQL. */
export async function guardarPackingList(
  id: string | null,
  input: GuardarPackingListInput,
  userId: string,
  opciones: OpcionesValores = {}
): Promise<ResultadoPacking<PackingListDetalle>> {
  const puedeVerValores = opciones.puedeVerValores === true;
  const puedeVerControl = opciones.puedeVerControl === true;
  const cabecera = cabeceraParaRpc(input, puedeVerValores);
  if (id !== null && input.version === undefined) {
    return { ok: false, error: MENSAJE_PACKING_SIN_VERSION, status: 400 };
  }
  if (input.clienteId) {
    const cliente = await validarClienteInternacional(input.clienteId);
    if (!cliente.ok) return cliente;
  }
  if (puedeVerControl && input.items.some(usaControlInterno) && !(await migracionLoteFotosAplicada())) {
    return { ok: false, error: MENSAJE_LOTE_FOTOS_NO_HABILITADO, status: 409 };
  }
  const items = input.items.map(i => itemParaRpc(i, puedeVerControl));
  // Fotos guardadas antes: las que se quiten de las paletas se borran del bucket tras guardar (ver borrarFotosSinReferencia).
  const fotosAntes = id !== null && puedeVerControl ? await leerFotosGuardadas(id) : [];
  // Al CREAR con clave, el envoltorio garantiza una sola fila; editar ya lo protege la versión (PL409).
  const { data, error } = id === null && input.clientRequestId
    ? await rpcConIdempotencia({
      clientRequestId: input.clientRequestId,
      capturadoEn: input.capturadoEn,
      envoltorio: 'guardar_packing_list_idem',
      original: 'guardar_packing_list',
      args: { p_id: null, p_cabecera: cabecera, p_items: items, p_usuario: userId, p_version_esperada: null },
      // El envoltorio solo crea: no recibe p_id ni la versión.
      omitirEnvoltorio: ['p_id', 'p_version_esperada'],
    })
    : await supabaseAdmin.rpc('guardar_packing_list', {
      p_id: id,
      p_cabecera: cabecera,
      p_items: items,
      p_usuario: userId,
      p_version_esperada: id === null ? null : input.version,
    });
  if (error || !data) return { ok: false, ...clasificarError(error ?? { message: 'No se pudo guardar el packing list.' }) };
  const guardadoId = String((data as { id?: string }).id ?? '');
  if (fotosAntes.length > 0) await borrarFotosSinReferencia(fotosAntes);
  const detalle = guardadoId ? await obtenerPackingList(guardadoId, { puedeVerValores, puedeVerControl }) : null;
  if (!detalle) return { ok: false, error: 'El packing list se guardó pero no se pudo leer de vuelta.', status: 500 };
  return { ok: true, valor: detalle };
}

export async function eliminarPackingList(id: string): Promise<ResultadoPacking<true>> {
  const fotosAntes = await leerFotosGuardadas(id);
  const { data, error } = await supabaseAdmin.from('packing_lists').delete().eq('id', id).select('id');
  if (error) return { ok: false, ...clasificarError(error) };
  if (!data || data.length === 0) return { ok: false, error: 'Packing list no encontrado.', status: 404 };
  if (fotosAntes.length > 0) await borrarFotosSinReferencia(fotosAntes);
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
