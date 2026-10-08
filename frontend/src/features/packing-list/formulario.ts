import type { PackingListDetalle, TipoEmbalajePackingList } from '@shared/types/index.js';
import type { GuardarPackingListInput } from '../../services/packing-list-service';
import { parsearPeso, siguienteNumeroPaleta, type FilaPackingList } from '../../lib/packing-list';
import type { FilaForm } from './PackingListFilas';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { parsearValorKg, textoValorKg } from '../../lib/proyeccion-packing';

/** Valores USD/kg en edición, por lote (clave '' = sin lote), como texto mientras se escribe. */
export type ValoresProyeccionForm = Record<string, string>;

export interface CabeceraForm {
  contenedor: string;
  fecha: string;
  tipoEmbalaje: TipoEmbalajePackingList;
  esPcb: boolean;
  descripcionEs: string;
  descripcionEn: string;
  observacionesEs: string;
  observacionesEn: string;
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
  };
}

export function cabeceraDesde(p: PackingListDetalle): CabeceraForm {
  return {
    contenedor: p.contenedor,
    fecha: p.fecha,
    tipoEmbalaje: p.tipoEmbalaje,
    esPcb: p.esPcb,
    descripcionEs: p.descripcionEs ?? '',
    descripcionEn: p.descripcionEn ?? '',
    observacionesEs: p.observacionesEs ?? '',
    observacionesEn: p.observacionesEn ?? '',
  };
}

const aTexto = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));

export function filasDesde(p: PackingListDetalle): FilaForm[] {
  return p.items.map(i => ({
    clave: nuevaClave(),
    numeroPaleta: aTexto(i.numeroPaleta),
    lote: i.lote ?? '',
    color: i.color ?? '',
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
    pesoBruto: parsearPeso(f.pesoBruto),
    pesoPaleta: f.pesoPaleta.trim() === '' ? 0 : parsearPeso(f.pesoPaleta),
  };
}

/** Fila nueva: copia lote, color y tara de la anterior (las paletas de un lote pesan parecido) y numera la paleta. */
export function filaSiguiente(filas: readonly FilaForm[]): FilaForm {
  const ultima = filas[filas.length - 1];
  const lote = ultima?.lote.trim() || null;
  const numeroPaleta = siguienteNumeroPaleta(filas.map(aFilaNumerica), lote);
  return {
    clave: nuevaClave(),
    numeroPaleta: String(numeroPaleta),
    lote: ultima?.lote ?? '',
    color: ultima?.color ?? '',
    pesoBruto: '',
    pesoPaleta: ultima?.pesoPaleta ?? '',
  };
}

export function valoresDesde(p: PackingListDetalle): ValoresProyeccionForm {
  return Object.fromEntries((p.proyeccion ?? []).map(l => [l.lote, textoValorKg(l.valorKgUsd)]));
}

/** Líneas de la proyección para enviar: solo lotes con valor. Un texto inválido devuelve el error. */
function construirProyeccion(
  valores: ValoresProyeccionForm,
  lotesIncluidos: ReadonlySet<string>
): { proyeccion: NonNullable<GuardarPackingListInput['proyeccion']> } | { error: string } {
  const proyeccion: NonNullable<GuardarPackingListInput['proyeccion']> = [];
  for (const [lote, texto] of Object.entries(valores)) {
    if (!lotesIncluidos.has(lote) || texto.trim() === '') continue;
    const valorKgUsd = parsearValorKg(texto);
    if (valorKgUsd === null) return { error: `Proyección${lote ? ` (lote ${lote})` : ''}: el valor por kg no es válido (máximo 4 decimales).` };
    proyeccion.push({ lote, valorKgUsd });
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
  valores?: ValoresProyeccionForm
): { entrada: GuardarPackingListInput } | { error: string } {
  if (c.contenedor.trim() === '') return { error: 'Indica el número de contenedor.' };
  if (c.fecha === '') return { error: 'Indica la fecha.' };
  const items: GuardarPackingListInput['items'] = [];
  for (const [i, f] of filas.entries()) {
    const n = aFilaNumerica(f, i);
    if (n.pesoBruto === null || n.pesoBruto <= 0) return { error: `Fila ${i + 1}: indica el peso bruto.` };
    if (n.pesoPaleta === null) return { error: `Fila ${i + 1}: el peso de la paleta no es un número válido.` };
    if (n.pesoPaleta > n.pesoBruto) return { error: `Fila ${i + 1}: la tara de la paleta no puede ser mayor al peso bruto.` };
    items.push({ numero: i + 1, numeroPaleta: n.numeroPaleta, lote: c.esPcb ? n.lote : null, color: c.esPcb ? n.color : null, pesoBruto: n.pesoBruto, pesoPaleta: n.pesoPaleta });
  }
  const lotes = new Set(items.map(i => i.lote ?? ''));
  const proy = valores ? construirProyeccion(valores, lotes) : null;
  if (proy && 'error' in proy) return { error: proy.error };
  return {
    entrada: {
      ...(proy ? { proyeccion: proy.proyeccion } : {}),
      contenedor: c.contenedor.trim(),
      fecha: c.fecha,
      tipoEmbalaje: c.tipoEmbalaje,
      esPcb: c.esPcb,
      descripcionEs: vacioANull(c.descripcionEs),
      descripcionEn: vacioANull(c.descripcionEn),
      observacionesEs: vacioANull(c.observacionesEs),
      observacionesEn: vacioANull(c.observacionesEn),
      ...referencia,
      items,
    },
  };
}
