import type { OpcionLotePacking } from '@shared/types/index.js';
import { calcularNeto, redondear2, type FilaPackingList } from './packing-list';

/**
 * Selector de lote del packing list y control de disponible. Puro, sin React.
 * Todo lo que sale de aquí (disponible, almacén) es de CONTROL INTERNO: se muestra en el editor, nunca en los PDF.
 */

const normalizar = (t: string | null | undefined): string => (t ?? '').trim().toLowerCase();

/** Clave estable de una opción del selector: lote + almacén. */
export const claveOpcionLote = (o: Pick<OpcionLotePacking, 'loteId' | 'almacenId'>): string => `${o.loteId}|${o.almacenId ?? ''}`;

/** Opción que corresponde al lote (texto guardado: "1" o "LOTE 1") y almacén de una fila; null si es texto libre antiguo. */
export function opcionDeFila(
  opciones: readonly OpcionLotePacking[],
  lote: string | null,
  almacenId: string | null
): OpcionLotePacking | null {
  const texto = normalizar(lote);
  if (texto === '') return null;
  const coincide = (o: OpcionLotePacking) => normalizar(o.valor) === texto || normalizar(o.nombre) === texto;
  // Si no se pudo leer el stock del lote, su única opción no tiene almacén: sirve para cualquier almacén guardado en la fila.
  return opciones.find(o => o.almacenId === almacenId && coincide(o))
    ?? opciones.find(o => o.disponibilidadNoLeida === true && coincide(o))
    ?? null;
}

export interface ControlDisponible {
  lote: string;
  almacenId: string | null;
  almacenNombre: string | null;
  /** Kg netos de este packing list para ese lote y almacén. */
  usadoKg: number;
  /** null = lote guardado a mano o sin opción: no hay con qué comparar. */
  disponibleKg: number | null;
  excesoKg: number;
  /** El packing supera lo disponible. Solo avisa: el cliente decide, no se bloquea el guardado. */
  excede: boolean;
  /** Solo presente (true) si falló la lectura del stock de ese lote: no se compara y se avisa que no se pudo leer. */
  disponibilidadNoLeida?: true;
}

type FilaControl = Pick<FilaPackingList, 'lote' | 'pesoBruto' | 'pesoPaleta'> & { almacenId?: string | null };

/** Kg usados por lote y almacén frente a lo disponible, en orden de aparición. Las filas sin lote se ignoran. */
export function controlarDisponible(filas: readonly FilaControl[], opciones: readonly OpcionLotePacking[]): ControlDisponible[] {
  const acumulado = new Map<string, ControlDisponible>();
  for (const f of filas) {
    const lote = f.lote?.trim() ?? '';
    if (lote === '') continue;
    const almacenId = f.almacenId ?? null;
    const clave = `${normalizar(lote)}|${almacenId ?? ''}`;
    const previo = acumulado.get(clave);
    const usadoKg = redondear2((previo?.usadoKg ?? 0) + calcularNeto(f.pesoBruto, f.pesoPaleta));
    const opcion = opcionDeFila(opciones, lote, almacenId);
    const disponibleKg = opcion ? opcion.disponibleKg : null;
    const noLeida = opcion?.disponibilidadNoLeida === true;
    const excesoKg = disponibleKg === null ? 0 : Math.max(0, redondear2(usadoKg - disponibleKg));
    acumulado.set(clave, {
      lote, almacenId, almacenNombre: opcion?.almacenNombre ?? null, usadoKg, disponibleKg, excesoKg, excede: excesoKg > 0,
      ...(noLeida ? { disponibilidadNoLeida: true as const } : {}),
    });
  }
  return [...acumulado.values()];
}

/** Texto de una opción del selector: "LOTE 1 · Almacén Norte · 1.250,00 kg disponibles". */
export function etiquetaOpcionLote(o: OpcionLotePacking): string {
  if (o.disponibilidadNoLeida) return `${o.nombre} · no se pudo leer la disponibilidad`;
  // Sin permiso de inventario el servidor no manda kg ni almacén: solo el lote.
  if (o.disponibleKg === null) return o.nombre;
  const kg = o.disponibleKg.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${o.nombre} · ${o.almacenNombre ?? 'sin stock en almacenes'} · ${kg} kg disponibles`;
}

/** Estado de la carga de la lista de lotes: «cargando» no es un fallo, solo «error» justifica el aviso. */
export type CargaLotes =
  | { estado: 'cargando'; opciones: null }
  | { estado: 'listo'; opciones: OpcionLotePacking[] }
  | { estado: 'error'; opciones: null };

export const CARGA_LOTES_INICIAL: CargaLotes = { estado: 'cargando', opciones: null };

/** Traduce la respuesta del servicio ({error} o la lista) al estado de carga. */
export function cargaLotesDesdeRespuesta(r: OpcionLotePacking[] | { error: string }): CargaLotes {
  return Array.isArray(r) ? { estado: 'listo', opciones: r } : { estado: 'error', opciones: null };
}

/** El aviso «no se pudo cargar la lista de lotes» solo aparece si la carga falló de verdad. */
export const mostrarAvisoLotesNoCargados = (carga: CargaLotes, esPcb: boolean): boolean => esPcb && carga.estado === 'error';
