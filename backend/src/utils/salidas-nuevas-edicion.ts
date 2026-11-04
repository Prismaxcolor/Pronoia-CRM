import type { SalidaMixtaInput } from '../schemas/transformaciones.js';
import { validarSalidasMixtasPorCategoria } from '../schemas/transformaciones.js';
import {
  netoDe,
  type EstadoPesos,
  type SalidaAuditable,
  type SnapshotAuditable,
} from './edicion-pesos-transformacion.js';

/**
 * Pesadas adicionales (salidas nuevas) al editar una transformación completa.
 * Lógica pura, espejo de la rama p_salidas_nuevas de editar_transformacion_pesos
 * (docs/migration_editar_transformacion_agregar_salidas.sql): el servicio valida
 * aquí antes de gastar la llave y la BD vuelve a validar en su transacción.
 */

export interface CabeceraParaSalidasNuevas {
  categoria: string;
  estado: string;
  loteOrigenId: string | null;
}

/** Id provisional (solo en memoria) de la salida nueva número `indice` (base 0). */
export const idSalidaNueva = (indice: number): string => `nueva-${indice + 1}`;

/** Estado de pesos con las salidas nuevas añadidas al final. No muta el original. */
export function agregarSalidasNuevas(estado: EstadoPesos, nuevas: ReadonlyArray<SalidaMixtaInput>): EstadoPesos {
  return {
    entrada: estado.entrada,
    salidas: [
      ...estado.salidas,
      ...nuevas.map((s, i) => ({ id: idSalidaNueva(i), pesoBruto: s.pesoBruto, tara: s.tara })),
    ],
  };
}

function errorFotos(categoria: string, nuevas: ReadonlyArray<SalidaMixtaInput>): string | null {
  if (categoria !== 'ferroso_no_ferroso') return null;
  const i = nuevas.findIndex(s => s.fotos.length === 0);
  return i >= 0 ? `Salida nueva ${i + 1}: agrega al menos una foto.` : null;
}

function errorLoteOrigen(cab: CabeceraParaSalidasNuevas, nuevas: ReadonlyArray<SalidaMixtaInput>): string | null {
  if (cab.categoria !== 'pcb' || !cab.loteOrigenId) return null;
  const vuelve = nuevas.some(s => s.tipo === 'lote' && s.loteDestinoId === cab.loteOrigenId);
  return vuelve ? 'El lote de destino no puede ser el mismo lote de origen.' : null;
}

/**
 * Mensaje de error si no se pueden agregar estas salidas; null si son válidas.
 * Las salidas a lote deben venir ya con almacén resuelto (completarAlmacenSalidas).
 * El balance de pesos lo valida validarPesos sobre el estado completo.
 */
export function validarSalidasNuevas(
  cab: CabeceraParaSalidasNuevas,
  nuevas: ReadonlyArray<SalidaMixtaInput>
): string | null {
  if (nuevas.length === 0) return null;
  if (cab.estado !== 'completa') {
    return 'Solo se pueden agregar salidas a una transformación completada: completa primero la transformación.';
  }
  return (
    validarSalidasMixtasPorCategoria(cab.categoria, nuevas) ??
    errorFotos(cab.categoria, nuevas) ??
    errorLoteOrigen(cab, nuevas)
  );
}

export interface NombresSalidaNueva { nombreProducto: string | null; nombreLoteDestino: string | null }

/** Snapshot auditable con las salidas nuevas añadidas (etiqueta ya resuelta). No muta el original. */
export function agregarSalidasNuevasASnapshot(
  snapshot: SnapshotAuditable,
  nuevas: ReadonlyArray<SalidaMixtaInput>,
  etiquetar: (salida: SalidaMixtaInput, indice: number) => string
): SnapshotAuditable {
  const filas: SalidaAuditable[] = nuevas.map((s, i) => ({
    id: idSalidaNueva(i),
    etiqueta: etiquetar(s, i),
    pesoBruto: s.pesoBruto,
    tara: s.tara,
    pesoNeto: netoDe(s.pesoBruto, s.tara),
  }));
  return { ...snapshot, salidas: [...snapshot.salidas, ...filas] };
}

/** Payload de una salida nueva para la RPC (snake_case). */
export function salidaNuevaARpc(s: SalidaMixtaInput) {
  return {
    tipo: s.tipo,
    producto_id: s.productoId ?? null,
    lote_destino_id: s.tipo === 'lote' ? s.loteDestinoId : null,
    almacen_id: s.almacenId ?? null,
    peso_bruto: s.pesoBruto,
    tara: s.tara,
    fotos: s.fotos,
  };
}
