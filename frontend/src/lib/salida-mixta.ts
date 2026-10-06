import type {
  ComposicionPCBItem,
  EntradaDetalleTransformacion,
  SalidaTransformacion,
} from '@shared/types/index.js';

/** Funciones puras de "salidas mixtas" de una transformación: una misma
 *  transformación puede producir salidas a lote y salidas a material suelto.
 *  Sin dependencias de React para poder probarlas desde fuera del frontend. */

export type CategoriaSalida = 'ferroso_no_ferroso' | 'pcb';
export type TipoSalida = 'material' | 'lote';

/** Cuerpo de cada salida de PATCH /api/transformaciones/:id/completar-mixta. */
export interface SalidaMixtaInput {
  tipo: TipoSalida;
  productoId?: string;
  loteDestinoId?: string;
  almacenId?: string;
  pesoBruto: number;
  tara: number;
  fotos: string[];
}

/** Datos mínimos de una fila de formulario para validar y armar el payload. */
export interface FilaSalidaMixta {
  tipo: TipoSalida;
  productoId: string;
  loteDestinoId: string;
  almacenId: string;
  /** Peso neto ya calculado (bruto - tara). */
  neto: number;
  cantidadFotos: number;
}

export interface ContextoValidacion {
  loteOrigenId?: string | null;
  pesoEntrada: number;
}

const TOLERANCIA_SUMA_KG = 0.01;

/** Tipo "natural" de cada categoría: ferroso -> material, PCB -> lote. */
export function tipoNatural(categoria: CategoriaSalida): TipoSalida {
  return categoria === 'pcb' ? 'lote' : 'material';
}

export function esFilaMixta(categoria: CategoriaSalida, tipo: TipoSalida): boolean {
  return tipo !== tipoNatural(categoria);
}

/** true si al menos una fila no es del tipo natural: solo entonces se usa el
 *  endpoint completar-mixta; si no, se mantiene el endpoint de siempre. */
export function hayFilasMixtas(
  categoria: CategoriaSalida,
  filas: ReadonlyArray<{ tipo: TipoSalida }>
): boolean {
  return filas.some(f => esFilaMixta(categoria, f.tipo));
}

function validarFilaPCB(f: FilaSalidaMixta, ctx: ContextoValidacion): string | null {
  if (f.tipo === 'lote') {
    // El almacén de un lote no se pregunta: lo resuelve el servidor (almacén de la transformación).
    if (!f.loteDestinoId) return 'Selecciona el lote de destino en cada fila.';
    if (f.loteDestinoId === ctx.loteOrigenId) return 'El lote destino debe ser distinto del lote origen.';
    return null;
  }
  if (!f.productoId) return 'Selecciona el material en cada salida de tipo material.';
  if (!f.almacenId) return 'Selecciona el almacén de destino en cada fila.';
  return null;
}

function validarFilaFerroso(f: FilaSalidaMixta): string | null {
  if (!f.productoId) return 'Todos los materiales de salida necesitan un producto.';
  if (f.tipo === 'lote') {
    if (!f.loteDestinoId) return 'Selecciona el lote de destino en cada salida a lote.';
  }
  return null;
}

/** Devuelve el primer error de validación o null si todo está bien.
 *  PCB: las fotos son opcionales y la suma no puede superar la entrada.
 *  Ferroso: cada salida exige al menos una foto. */
export function validarSalidas(
  categoria: CategoriaSalida,
  filas: ReadonlyArray<FilaSalidaMixta>,
  ctx: ContextoValidacion
): string | null {
  const esPCB = categoria === 'pcb';
  for (const f of filas) {
    const err = esPCB ? validarFilaPCB(f, ctx) : validarFilaFerroso(f);
    if (err) return err;
  }
  if (filas.some(f => f.neto <= 0)) {
    return esPCB ? 'Cada salida debe tener un peso neto mayor a 0.' : 'Cada salida debe tener peso neto mayor a 0.';
  }
  if (!esPCB && filas.some(f => f.cantidadFotos === 0)) return 'Cada salida necesita al menos una foto.';
  const total = filas.reduce((acc, f) => acc + f.neto, 0);
  if (esPCB && total > ctx.pesoEntrada + TOLERANCIA_SUMA_KG) {
    return `La suma de las salidas (${formatearKg(total)} kg) supera lo que entró (${formatearKg(ctx.pesoEntrada)} kg).`;
  }
  return null;
}

function formatearKg(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** Arma una salida del payload según las reglas del backend:
 *  - PCB+lote: loteDestinoId, sin productoId ni almacén (lo resuelve el servidor).
 *  - PCB+material: productoId + almacenId.
 *  - Ferroso+material: productoId (almacenId solo si se eligió).
 *  - Ferroso+lote: productoId + loteDestinoId (sin almacén; lo resuelve el servidor). */
export function armarSalidaMixta(
  categoria: CategoriaSalida,
  fila: Pick<FilaSalidaMixta, 'tipo' | 'productoId' | 'loteDestinoId' | 'almacenId'>,
  pesoBruto: number,
  tara: number,
  fotos: string[]
): SalidaMixtaInput {
  const base = { tipo: fila.tipo, pesoBruto, tara, fotos };
  if (fila.tipo === 'lote') {
    return categoria === 'pcb'
      ? { ...base, loteDestinoId: fila.loteDestinoId }
      : { ...base, productoId: fila.productoId, loteDestinoId: fila.loteDestinoId };
  }
  return fila.almacenId
    ? { ...base, productoId: fila.productoId, almacenId: fila.almacenId }
    : { ...base, productoId: fila.productoId };
}

/** Etiqueta de una salida: producto + lote -> "tarjeta → Lote X";
 *  solo producto -> "Material"; solo lote -> "Lote X". */
export function etiquetaSalida(
  s: Pick<SalidaTransformacion, 'nombreProducto' | 'nombreLoteDestino'>
): string {
  if (s.nombreProducto && s.nombreLoteDestino) return `${s.nombreProducto} → Lote ${s.nombreLoteDestino}`;
  if (s.nombreProducto) return s.nombreProducto;
  if (s.nombreLoteDestino) return `Lote ${s.nombreLoteDestino}`;
  return '—';
}

export interface ComposicionProyectada { item: string; porcentaje: number; esNuevo: boolean }

/** Estima cómo quedaría la composición del lote destino si esta salida se
 *  completa tal cual está ahora — mezclando lo que ya tiene el destino con
 *  lo que entra. Solo referencial: la composición real se recalcula a partir
 *  del stock real al completar.
 *
 *  `entradaDetalle` describe la composición de lo que entra. En PCB es lo que
 *  el backend congeló al crear la transformación; en una salida ferroso a lote
 *  es el material de la fila al 100%. */
export function proyectarComposicion(
  stockDestino: number,
  compDestino: ComposicionPCBItem[],
  entradaDetalle: EntradaDetalleTransformacion[],
  netoEntrante: number
): ComposicionProyectada[] {
  if (netoEntrante <= 0) return [];
  const stockTotalNuevo = stockDestino + netoEntrante;
  if (stockTotalNuevo <= 0) return [];

  const totalEntrada = entradaDetalle.reduce((acc, d) => acc + d.pesoKg, 0);
  const compOrigen = totalEntrada > 0
    ? entradaDetalle.map(d => ({ item: d.nombreProducto, porcentaje: (d.pesoKg / totalEntrada) * 100 }))
    : [];

  const itemsDestino = new Set(compDestino.map(c => c.item));
  const todosItems = Array.from(new Set([...compDestino.map(c => c.item), ...compOrigen.map(c => c.item)]));

  return todosItems
    .map(item => {
      const pctDestino = compDestino.find(c => c.item === item)?.porcentaje ?? 0;
      const pctOrigen = compOrigen.find(c => c.item === item)?.porcentaje ?? 0;
      const kg = (stockDestino * pctDestino) / 100 + (netoEntrante * pctOrigen) / 100;
      return { item, porcentaje: Math.round((kg / stockTotalNuevo) * 10000) / 100, esNuevo: !itemsDestino.has(item) };
    })
    .filter(c => c.porcentaje > 0)
    .sort((a, b) => b.porcentaje - a.porcentaje);
}
