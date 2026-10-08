/** Constructores (puros) de las peticiones de la Fase 4: describen QUÉ se envía; `ejecutarOEncolar`
 *  decide CÓMO (en línea o en la cola). Ninguno toca la red, el reloj ni IndexedDB. */
import type { FotoLocal } from '../../foto-picker';
import type { PeticionF4 } from './ejecutar-o-encolar';
import type { TipoEntidadTemporal } from './ids-temporales';
import { packingListProvisional, type DatosPackingList } from './packing-f4';
import { ENDPOINT_F4, TIPO_F4, type TipoF4 } from './tipos-f4';

const fmtKg = (n: number): string => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

// ---- toma física --------------------------------------------------------------------------

export interface DatosTomaCrear {
  almacenId: string;
  categoriaIds: string[];
  loteIds?: string[];
  alcance: 'categoria' | 'lote';
  productoIds?: string[];
  descripcion?: string | null;
}

/** Nombres que ya conoce el formulario, solo para mostrar la toma provisional. */
export interface NombresTomaProvisional {
  almacenNombre?: string | null;
  categoriaNombres?: string[];
}

export function tomaProvisional(
  datos: DatosTomaCrear,
  idTemporal: string,
  ahoraIso: string,
  nombres: NombresTomaProvisional = {},
): Record<string, unknown> {
  return {
    id: idTemporal,
    codigo: 'PEND',
    numero: 0,
    descripcion: datos.descripcion ?? null,
    almacenId: datos.almacenId,
    almacenNombre: nombres.almacenNombre ?? null,
    categoriaIds: datos.categoriaIds,
    categoriaNombres: nombres.categoriaNombres ?? [],
    loteIds: datos.loteIds ?? [],
    loteNombres: [],
    productoIds: datos.productoIds ?? [],
    alcance: datos.alcance,
    estado: 'abierta',
    abiertaPor: '',
    abiertaEn: ahoraIso,
    cerradaPor: null,
    cerradaEn: null,
    createdAt: ahoraIso,
  };
}

export function peticionTomaCrear(
  datos: DatosTomaCrear,
  idTemporal: string,
  ahoraIso: string,
  nombres?: NombresTomaProvisional,
): PeticionF4 {
  return {
    tipoOperacion: TIPO_F4.tomaCrear,
    endpoint: ENDPOINT_F4.tomas,
    metodo: 'POST',
    descripcion: datos.descripcion ? `Nueva toma física: ${datos.descripcion}` : 'Nueva toma física de inventario',
    grupos: [],
    cuerpo: () => datos,
    alta: { idTemporal, entidad: 'toma_fisica', provisional: tomaProvisional(datos, idTemporal, ahoraIso, nombres) },
  };
}

export interface DatosPesajeToma {
  productoId?: string | null;
  loteId?: string | null;
  pesoBruto: number;
  tara: number;
}

export function peticionPesajeToma(tomaFisicaId: string, datos: DatosPesajeToma, fotos: FotoLocal[], etiqueta?: string): PeticionF4 {
  const neto = datos.pesoBruto - datos.tara;
  return {
    tipoOperacion: TIPO_F4.tomaPesaje,
    endpoint: `${ENDPOINT_F4.tomas}/${tomaFisicaId}/pesajes`,
    metodo: 'POST',
    descripcion: `Conteo de toma física${etiqueta ? `: ${etiqueta}` : ''} (${fmtKg(neto)} kg)`,
    grupos: [fotos],
    cuerpo: ([urls]) => ({
      productoId: datos.productoId ?? null,
      loteId: datos.loteId ?? null,
      pesoBruto: datos.pesoBruto,
      tara: datos.tara,
      fotos: urls,
    }),
  };
}

// ---- altas de maestros -------------------------------------------------------------------------

export type TipoMaestro = 'proveedor' | 'cliente' | 'producto' | 'tara' | 'almacen' | 'vehiculo';

interface DefinicionMaestro {
  tipo: TipoF4;
  endpoint: string;
  entidad: TipoEntidadTemporal;
  etiqueta: string;
  /** Campos que la entidad provisional necesita y el formulario no envía. */
  porDefecto: Record<string, unknown>;
}

const DEFINICIONES: Record<TipoMaestro, DefinicionMaestro> = {
  proveedor: {
    tipo: TIPO_F4.proveedorCrear, endpoint: ENDPOINT_F4.proveedores, entidad: 'proveedor', etiqueta: 'Nuevo proveedor',
    porDefecto: { rfc: null, telefono: null, email: null, telegramChatId: null, telegramLinkedAt: null },
  },
  cliente: {
    tipo: TIPO_F4.clienteCrear, endpoint: ENDPOINT_F4.clientes, entidad: 'cliente', etiqueta: 'Nuevo cliente',
    porDefecto: { identificacion: null, email: null, telefono: null, direccion: null, notas: null, creadoPor: '', telegramChatId: null, telegramLinkedAt: null },
  },
  producto: {
    tipo: TIPO_F4.productoCrear, endpoint: ENDPOINT_F4.productos, entidad: 'producto', etiqueta: 'Nuevo producto',
    porDefecto: { descripcion: '', creadoPor: '' },
  },
  tara: { tipo: TIPO_F4.taraCrear, endpoint: ENDPOINT_F4.taras, entidad: 'tara', etiqueta: 'Nueva tara', porDefecto: {} },
  almacen: {
    tipo: TIPO_F4.almacenCrear, endpoint: ENDPOINT_F4.almacenes, entidad: 'almacen', etiqueta: 'Nuevo almacén',
    porDefecto: { detalle: null, esPredeterminado: false, ultimaTomaFisica: null },
  },
  vehiculo: {
    tipo: TIPO_F4.vehiculoCrear, endpoint: ENDPOINT_F4.vehiculos, entidad: 'vehiculo', etiqueta: 'Nuevo vehículo',
    porDefecto: { placa: null, marca: null, modelo: null, color: null, conductor: null, descripcion: null },
  },
};

export const ENTIDAD_DE_MAESTRO: Readonly<Record<TipoMaestro, TipoEntidadTemporal>> = {
  proveedor: 'proveedor', cliente: 'cliente', producto: 'producto', tara: 'tara', almacen: 'almacen', vehiculo: 'vehiculo',
};

/** Entidad provisional: los datos tal como se escribieron, con id temporal y activa. Las fotos nuevas
 *  todavía no tienen URL: se muestran sin foto hasta sincronizar. */
export function maestroProvisional(
  tipo: TipoMaestro,
  datos: Record<string, unknown>,
  idTemporal: string,
  ahoraIso: string,
): Record<string, unknown> {
  const campos = DEFINICIONES[tipo].porDefecto;
  const fechas = tipo === 'cliente' || tipo === 'producto' ? { creadoEn: ahoraIso } : { createdAt: ahoraIso };
  return { ...campos, ...datos, ...fechas, id: idTemporal, activo: true, fotos: [] };
}

export function peticionAltaMaestro(
  tipo: TipoMaestro,
  datos: Record<string, unknown>,
  fotos: FotoLocal[],
  idTemporal: string,
  ahoraIso: string,
): PeticionF4 {
  const def = DEFINICIONES[tipo];
  const nombre = typeof datos.nombre === 'string' && datos.nombre ? `: ${datos.nombre}` : '';
  return {
    tipoOperacion: def.tipo,
    endpoint: def.endpoint,
    metodo: 'POST',
    descripcion: `${def.etiqueta}${nombre}`,
    grupos: [fotos],
    cuerpo: ([urls]) => ({ ...datos, fotos: urls }),
    alta: { idTemporal, entidad: def.entidad, provisional: maestroProvisional(tipo, datos, idTemporal, ahoraIso) },
  };
}

// ---- transformaciones --------------------------------------------------------------------------------------

export type CategoriaCreacion = 'ferroso' | 'pcb';

/** Una pesada de la entrada, con su tara ya calculada en kg y sus fotos. */
export interface PesadaEntradaConFotos {
  pesoBruto: number;
  tara: number;
  fotos: FotoLocal[];
}

export interface DatosTransformacionCrear {
  /** Ferroso: productoEntradaId. PCB: loteOrigenId. */
  productoEntradaId?: string;
  loteOrigenId?: string;
  almacenId: string;
  fecha: string;
  notas?: string | null;
}

export function sumarPesadas(pesadas: ReadonlyArray<{ pesoBruto: number; tara: number }>): { bruto: number; tara: number; neto: number } {
  const bruto = pesadas.reduce((s, p) => s + p.pesoBruto, 0);
  const tara = pesadas.reduce((s, p) => s + p.tara, 0);
  return { bruto, tara, neto: bruto - tara };
}

export function transformacionProvisional(
  categoria: CategoriaCreacion,
  datos: DatosTransformacionCrear,
  pesadas: ReadonlyArray<{ pesoBruto: number; tara: number }>,
  idTemporal: string,
  ahoraIso: string,
): Record<string, unknown> {
  const t = sumarPesadas(pesadas);
  return {
    id: idTemporal,
    numero: null,
    codigo: 'PEND',
    categoria: categoria === 'pcb' ? 'pcb' : 'ferroso_no_ferroso',
    productoEntradaId: datos.productoEntradaId ?? null,
    nombreProductoEntrada: null,
    almacenId: datos.almacenId,
    loteOrigenId: datos.loteOrigenId ?? null,
    nombreLoteOrigen: null,
    pesoBruto: t.bruto,
    tara: t.tara,
    pesoNeto: t.neto,
    fotosEntrada: [],
    fecha: datos.fecha,
    estado: 'bruto',
    notas: datos.notas ?? null,
    registradoPor: null,
    completadoPor: null,
    completadoEn: null,
    createdAt: ahoraIso,
    entradaDetalle: [],
    salidas: [],
  };
}

export function peticionTransformacionCrear(
  categoria: CategoriaCreacion,
  datos: DatosTransformacionCrear,
  pesadas: PesadaEntradaConFotos[],
  idTemporal: string,
  ahoraIso: string,
): PeticionF4 {
  const total = sumarPesadas(pesadas);
  const etiqueta = pesadas.length > 1 ? `${pesadas.length} pesadas, ${fmtKg(total.neto)} kg netos` : `${fmtKg(total.neto)} kg netos`;
  return {
    tipoOperacion: categoria === 'pcb' ? TIPO_F4.transformacionPcbCrear : TIPO_F4.transformacionFerrosoCrear,
    endpoint: `${ENDPOINT_F4.transformaciones}/${categoria === 'pcb' ? 'pcb' : 'ferroso'}`,
    metodo: 'POST',
    descripcion: `Nueva transformación ${categoria === 'pcb' ? 'PCB' : 'Ferroso/No Ferroso'} (${etiqueta})`,
    grupos: pesadas.map(p => p.fotos),
    cuerpo: fotos => ({
      ...datos,
      pesadasEntrada: pesadas.map((p, i) => ({ pesoBruto: p.pesoBruto, tara: p.tara, fotos: fotos[i] ?? [] })),
    }),
    alta: { idTemporal, entidad: 'transformacion', provisional: transformacionProvisional(categoria, datos, pesadas, idTemporal, ahoraIso) },
  };
}

export type VarianteCompletar = 'ferroso' | 'pcb' | 'mixta';

const TIPO_COMPLETAR: Record<VarianteCompletar, TipoF4> = {
  ferroso: TIPO_F4.transformacionFerrosoCompletar,
  pcb: TIPO_F4.transformacionPcbCompletar,
  mixta: TIPO_F4.transformacionMixtaCompletar,
};

export interface SalidaConFotos {
  /** Campos de la salida tal como los espera el servidor, sin `fotos`. */
  datos: Record<string, unknown>;
  pesoBruto: number;
  tara: number;
  fotos: FotoLocal[];
}

export function peticionTransformacionCompletar(
  variante: VarianteCompletar,
  transformacionId: string,
  salidas: SalidaConFotos[],
  mermaDetalle?: unknown,
): PeticionF4 {
  const neto = salidas.reduce((s, x) => s + x.pesoBruto - x.tara, 0);
  return {
    tipoOperacion: TIPO_COMPLETAR[variante],
    endpoint: `${ENDPOINT_F4.transformaciones}/${transformacionId}/completar-${variante}`,
    metodo: 'PATCH',
    descripcion: `Completar transformación (${salidas.length} ${salidas.length === 1 ? 'salida' : 'salidas'}, ${fmtKg(neto)} kg netos)`,
    grupos: salidas.map(s => s.fotos),
    cuerpo: fotos => ({
      salidas: salidas.map((s, i) => ({ ...s.datos, pesoBruto: s.pesoBruto, tara: s.tara, fotos: fotos[i] ?? [] })),
      ...(mermaDetalle ? { mermaDetalle } : {}),
    }),
  };
}

// ---- packing list ------------------------------------------------------------------------------------------------------

/** El servidor responde 409 con este texto (más «; recarga.») cuando la versión base ya no es la vigente:
 *  la cola la deja en «rechazadas» con ese mensaje, sin perder lo capturado. */
export const MENSAJE_CONFLICTO_PACKING = 'Otra persona modificó este packing list';

export function peticionPackingListCrear(
  datos: Record<string, unknown>,
  idTemporal: string,
  ahoraIso: string,
): PeticionF4 {
  const contenedor = typeof datos.contenedor === 'string' ? datos.contenedor : '';
  return {
    tipoOperacion: TIPO_F4.packingListCrear,
    endpoint: ENDPOINT_F4.packingLists,
    metodo: 'POST',
    descripcion: `Nuevo packing list${contenedor ? `: ${contenedor}` : ''}`,
    grupos: [],
    cuerpo: () => datos,
    alta: { idTemporal, entidad: 'packing_list', provisional: packingListProvisional(datos as unknown as DatosPackingList, idTemporal, ahoraIso) as unknown as Record<string, unknown> },
  };
}

/** Edición con la versión base que el usuario cargó: si otra persona guardó antes, el servidor responde 409. */
export function peticionPackingListEditar(id: string, datos: Record<string, unknown>, versionBase: number): PeticionF4 {
  const contenedor = typeof datos.contenedor === 'string' ? datos.contenedor : '';
  return {
    tipoOperacion: TIPO_F4.packingListEditar,
    endpoint: `${ENDPOINT_F4.packingLists}/${id}`,
    metodo: 'PUT',
    descripcion: `Editar packing list${contenedor ? `: ${contenedor}` : ''}`,
    grupos: [],
    cuerpo: () => ({ ...datos, version: versionBase }),
  };
}
