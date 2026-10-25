import type { Cliente, PackingListDetalle, TipoEmbalajePackingList } from '@shared/types/index.js';
import type { GuardarPackingListInput } from '../../services/packing-list-service';
import { parsearPeso, siguienteNumeroPaleta, type FilaPackingList } from '../../lib/packing-list';
import type { FilaForm } from './PackingListFilas';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { parsearValorKg, textoValorKg } from '../../lib/proyeccion-packing';
import { parsearTotalUsd, textoTotalUsd } from '../../lib/resultados-exportacion';

/** Valores USD/kg en edición, por lote (clave '' = sin lote), como texto mientras se escribe. */
export type ValoresProyeccionForm = Record<string, string>;

/** Valoración en edición: USD/kg estimado (proyección) y real (resultados) por lote, y el total real cobrado (texto). */
export interface ValoracionForm {
  estimado: ValoresProyeccionForm;
  real: ValoresProyeccionForm;
  /** Total real cobrado de la exportación en USD, como texto mientras se escribe ('' = sin cargar). */
  totalReal: string;
}

export const valoracionVacia = (): ValoracionForm => ({ estimado: {}, real: {}, totalReal: '' });

export interface CabeceraForm {
  contenedor: string;
  fecha: string;
  tipoEmbalaje: TipoEmbalajePackingList;
  esPcb: boolean;
  descripcionEs: string;
  descripcionEn: string;
  observacionesEs: string;
  observacionesEn: string;
  /** Cliente internacional elegido; '' = sin cliente. */
  clienteId: string;
}

// Descripciones iniciales de una lista nueva (editables). La traducción al español es del sistema, no del dueño.
export const DESCRIPCION_INICIAL_EN = 'USED INTEGRATED ELECTRONIC CIRCUITS';
export const DESCRIPCION_INICIAL_ES = 'CIRCUITOS INTEGRADOS ELECTRÓNICOS USADOS';

export const OPCIONES_EMBALAJE: ReadonlyArray<{ valor: TipoEmbalajePackingList; etiqueta: string; bulto: string }> = [
  { valor: 'big_bag', etiqueta: 'Big bags (sobre paletas de madera)', bulto: 'Big bag' },
  { valor: 'paleta', etiqueta: 'Paletas', bulto: 'Paleta' },
  { valor: 'paquete', etiqueta: 'Paquetes', bulto: 'Paquete' },
];

let contador = 0;
export const nuevaClave = (): string => `fila-${Date.now()}-${contador++}`;

export function hoyIso(): string {
  return hoyNegocio();
}

export function cabeceraInicial(): CabeceraForm {
  return {
    contenedor: '',
    fecha: hoyIso(),
    tipoEmbalaje: 'big_bag',
    esPcb: true,
    descripcionEs: DESCRIPCION_INICIAL_ES,
    descripcionEn: DESCRIPCION_INICIAL_EN,
    observacionesEs: '',
    observacionesEn: '',
    clienteId: '',
  };
}

/** Ya no hay casilla PCB: todos los lotes muestran siempre lote y color, sea cual sea el es_pcb guardado en la lista. */
export const MOSTRAR_LOTE_Y_COLOR = true;

export function cabeceraDesde(p: PackingListDetalle): CabeceraForm {
  return {
    contenedor: p.contenedor,
    fecha: p.fecha,
    tipoEmbalaje: p.tipoEmbalaje,
    // Se conserva el valor guardado (no se reescribe al guardar). La UI muestra siempre lote y color: ver MOSTRAR_LOTE_Y_COLOR.
    esPcb: p.esPcb,
    descripcionEs: p.descripcionEs ?? '',
    descripcionEn: p.descripcionEn ?? '',
    observacionesEs: p.observacionesEs ?? '',
    observacionesEn: p.observacionesEn ?? '',
    clienteId: p.clienteId ?? '',
  };
}

const aTexto = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));

export function filasDesde(p: PackingListDetalle): FilaForm[] {
  return p.items.map(i => ({
    clave: nuevaClave(),
    numeroPaleta: aTexto(i.numeroPaleta),
    lote: i.lote ?? '',
    color: i.color ?? '',
    almacenId: i.almacenId ?? '',
    fotos: [...(i.fotos ?? [])],
    pesoBruto: aTexto(i.pesoBruto),
    pesoPaleta: aTexto(i.pesoPaleta),
  }));
}

/** Fila numérica para los cálculos (los pesos vacíos o inválidos quedan en null). */
export function aFilaNumerica(f: FilaForm, indice: number): FilaPackingList {
  return {
    numero: indice + 1,
    numeroPaleta: /^\d+$/.test(f.numeroPaleta.trim()) ? Number(f.numeroPaleta.trim()) : null,
    lote: f.lote.trim() || null,
    color: f.color || null,
    almacenId: f.almacenId || null,
    pesoBruto: parsearPeso(f.pesoBruto),
    pesoPaleta: f.pesoPaleta.trim() === '' ? 0 : parsearPeso(f.pesoPaleta),
  };
}

/** Fila nueva: copia lote, almacén, color y tara de la anterior (las paletas de un lote pesan parecido) y numera la paleta. Las fotos no se copian. */
export function filaSiguiente(filas: readonly FilaForm[]): FilaForm {
  const ultima = filas[filas.length - 1];
  const lote = ultima?.lote.trim() || null;
  const numeroPaleta = siguienteNumeroPaleta(filas.map(aFilaNumerica), lote);
  return {
    clave: nuevaClave(),
    numeroPaleta: String(numeroPaleta),
    lote: ultima?.lote ?? '',
    color: ultima?.color ?? '',
    almacenId: ultima?.almacenId ?? '',
    fotos: [],
    pesoBruto: '',
    pesoPaleta: ultima?.pesoPaleta ?? '',
  };
}

const textoDe = (n: number | null | undefined): string => (n == null ? '' : textoValorKg(n));

export function valoracionDesde(p: PackingListDetalle): ValoracionForm {
  const lineas = p.proyeccion ?? [];
  return {
    estimado: Object.fromEntries(lineas.map(l => [l.lote, textoDe(l.valorKgUsd)])),
    real: Object.fromEntries(lineas.map(l => [l.lote, textoDe(l.valorRealKgUsd)])),
    totalReal: textoTotalUsd(p.totalRealUsd),
  };
}

/** Total real cobrado escrito a mano -> número. Vacío = null; inválido = error legible. */
function leerTotalReal(texto: string): { total: number | null } | { error: string } {
  if (texto.trim() === '') return { total: null };
  const total = parsearTotalUsd(texto);
  return total === null ? { error: 'Total real cobrado: el monto no es válido (máximo 2 decimales).' } : { total };
}

type LineaProyeccion = NonNullable<GuardarPackingListInput['proyeccion']>[number];

/** Texto escrito a mano -> valor. Vacío = null; inválido = error con el nombre del campo. */
function leerValor(texto: string | undefined, lote: string, campo: string): { valor: number | null } | { error: string } {
  if ((texto ?? '').trim() === '') return { valor: null };
  const valor = parsearValorKg(texto ?? '');
  if (valor === null) return { error: `${campo}${lote ? ` (lote ${lote})` : ''}: el valor por kg no es válido (máximo 4 decimales).` };
  return { valor };
}

/** Líneas de la proyección/resultados para enviar: solo lotes con algún valor. Un texto inválido devuelve el error. */
function construirProyeccion(
  valoracion: ValoracionForm,
  lotesIncluidos: ReadonlySet<string>
): { proyeccion: LineaProyeccion[] } | { error: string } {
  const lotes = new Set([...Object.keys(valoracion.estimado), ...Object.keys(valoracion.real)]);
  const proyeccion: LineaProyeccion[] = [];
  for (const lote of lotes) {
    if (!lotesIncluidos.has(lote)) continue;
    const estimado = leerValor(valoracion.estimado[lote], lote, 'Proyección');
    if ('error' in estimado) return estimado;
    const real = leerValor(valoracion.real[lote], lote, 'Valor real');
    if ('error' in real) return real;
    if (estimado.valor === null && real.valor === null) continue;
    proyeccion.push({ lote, valorKgUsd: estimado.valor, valorRealKgUsd: real.valor });
  }
  return { proyeccion };
}

const vacioANull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** Valida y arma lo que se envía al backend. Devuelve el primer error legible. */
export function construirEntrada(
  c: CabeceraForm,
  filas: readonly FilaForm[],
  referencia: Pick<GuardarPackingListInput, 'referenciaTipo' | 'referenciaId' | 'version'>,
  /** Solo si el usuario ve valores (facturacion:ver); undefined = no enviar proyección. */
  valoracion?: ValoracionForm,
  /** Con permiso de inventario o facturación (control interno). Sin él no se envían almacén ni fotos: el servidor conserva lo guardado. */
  conControl = true,
  /** true = guardar como borrador: se permite dejar sin contenedor y sin pesos; se exigen solo al finalizar. */
  borrador = false
): { entrada: GuardarPackingListInput } | { error: string } {
  if (!borrador && c.contenedor.trim() === '') return { error: 'Indica el número de contenedor.' };
  if (c.fecha === '') return { error: 'Indica la fecha.' };
  const items: GuardarPackingListInput['items'] = [];
  for (const [i, f] of filas.entries()) {
    const n = aFilaNumerica(f, i);
    if (n.pesoPaleta === null) return { error: `Fila ${i + 1}: el peso de la paleta no es un número válido.` };
    if (!borrador && (n.pesoBruto === null || n.pesoBruto <= 0)) return { error: `Fila ${i + 1}: indica el peso bruto.` };
    // En un borrador un peso bruto vacío queda en 0 (y la tara también, porque no puede superar al bruto).
    const pesoBruto = n.pesoBruto ?? 0;
    if (borrador && f.pesoBruto.trim() !== '' && n.pesoBruto === null) return { error: `Fila ${i + 1}: el peso bruto no es un número válido.` };
    const pesoPaleta = pesoBruto === 0 && borrador ? 0 : n.pesoPaleta;
    if (pesoPaleta > pesoBruto) return { error: `Fila ${i + 1}: la tara de la paleta no puede ser mayor al peso bruto.` };
    items.push({
      numero: i + 1, numeroPaleta: n.numeroPaleta, lote: n.lote, color: n.color,
      ...(conControl ? { almacenId: n.almacenId ?? null, fotos: f.fotos.map(x => x.ruta) } : {}),
      pesoBruto, pesoPaleta,
    });
  }
  const lotes = new Set(items.map(i => i.lote ?? ''));
  const proy = valoracion ? construirProyeccion(valoracion, lotes) : null;
  if (proy && 'error' in proy) return { error: proy.error };
  const total = valoracion ? leerTotalReal(valoracion.totalReal) : null;
  if (total && 'error' in total) return { error: total.error };
  return {
    entrada: {
      ...(proy ? { proyeccion: proy.proyeccion } : {}),
      ...(total ? { totalRealUsd: total.total } : {}),
      esBorrador: borrador,
      contenedor: c.contenedor.trim(),
      fecha: c.fecha,
      tipoEmbalaje: c.tipoEmbalaje,
      esPcb: c.esPcb,
      descripcionEs: vacioANull(c.descripcionEs),
      descripcionEn: vacioANull(c.descripcionEn),
      observacionesEs: vacioANull(c.observacionesEs),
      observacionesEn: vacioANull(c.observacionesEn),
      clienteId: vacioANull(c.clienteId),
      ...referencia,
      items,
    },
  };
}

export interface OpcionCliente {
  id: string;
  nombre: string;
}

/** Solo clientes internacionales activos; si el packing list ya apunta a otro (o a uno desactivado), se conserva visible. */
export function opcionesCliente(clientes: readonly Cliente[], actualId: string, actualNombre: string | null): OpcionCliente[] {
  const validos = clientes.filter(c => c.tipoVenta === 'internacional' && c.activo).map(c => ({ id: c.id, nombre: c.nombre }));
  if (actualId === '' || validos.some(c => c.id === actualId)) return validos;
  const conocido = clientes.find(c => c.id === actualId)?.nombre ?? actualNombre ?? 'Cliente vinculado';
  return [{ id: actualId, nombre: conocido }, ...validos];
}
