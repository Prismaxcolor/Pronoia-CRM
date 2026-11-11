/** Textos y tonos de una fila de Registros (lógica pura). Se prueba en backend/tests/wallet-registros-texto.test.ts. */

import type { Movimiento } from '@shared/types/index.js';
import type { Tono } from '../../../lib/paleta';
import { etiquetaEstadoMesa } from '../../cochinito/detalle-movimiento';
import { formatearMonto } from '../wallet-grupos';
import type { FilaVirtual } from './registros-patas';
import { tituloMovimiento, type TonoMonto } from './registros-logica';

export const TEXTO_PENDIENTE = 'Pendiente';

/** Monto de la fila con su signo y su moneda; "Pendiente" (mesa en proceso) o "—" (no se conoce). */
export function textoMontoFila(f: Pick<FilaVirtual, 'monto' | 'moneda' | 'estadoCobro'>): string {
  if (f.estadoCobro === 'pendiente') return TEXTO_PENDIENTE;
  if (f.monto == null) return '—';
  return `${f.monto > 0 ? '+' : ''}${formatearMonto(f.monto, f.moneda)}`;
}

/** "Falta cobrar Bs 2.900,00" en las patas destino de una mesa en proceso o parcial; null en cualquier otra. */
export function textoFaltaCobrar(f: Pick<FilaVirtual, 'faltaCobrar' | 'moneda' | 'estadoCobro'>): string | null {
  if (f.estadoCobro === 'normal' || f.faltaCobrar == null) return null;
  return `Falta cobrar ${formatearMonto(f.faltaCobrar, f.moneda)}`;
}

export function tonoDeFila(f: Pick<FilaVirtual, 'monto' | 'estadoCobro' | 'movimiento'>): TonoMonto {
  if (f.movimiento.anulado || f.estadoCobro === 'pendiente' || f.monto == null || f.monto === 0) return 'neutro';
  return f.monto > 0 ? 'positivo' : 'negativo';
}

export interface EstadoVisible { texto: string; tono: Tono }

/** Insignia de estado con texto: Anulado, En proceso, Cobro parcial o Completada (mesa). Una fila normal vigente no lleva. */
export function estadoVisible(m: Pick<Movimiento, 'anulado' | 'mesaCambistaId' | 'mesaEstado'>): EstadoVisible | null {
  if (m.anulado) return { texto: 'Anulado', tono: 'peligro' };
  const mesa = etiquetaEstadoMesa(m);
  if (mesa === 'Completada') return { texto: mesa, tono: 'exito' };
  return mesa ? { texto: mesa, tono: 'aviso' } : null;
}

export interface TerceroFila { rol: 'Proveedor' | 'Cliente'; texto: string; tono: Tono }

/** Chip del tercero: color por rol (proveedor / cliente) y siempre con texto. */
export function terceroDeFila(m: Pick<Movimiento, 'proveedorId' | 'clienteId'>, nombre: string | null): TerceroFila | null {
  const rol = m.proveedorId ? 'Proveedor' : m.clienteId ? 'Cliente' : null;
  if (!rol) return null;
  return { rol, texto: nombre ? `${rol}: ${nombre}` : rol, tono: rol === 'Proveedor' ? 'info' : 'marca' };
}

/** Título de la fila: las patas de una transferencia dicen si sale o entra; el resto como siempre. */
export function tituloDeFila(f: Pick<FilaVirtual, 'pata' | 'movimiento'>, nombreCategoria: string | null): string {
  if (f.pata === 'origen') return 'Transferencia enviada';
  if (f.pata === 'destino') return 'Transferencia recibida';
  return tituloMovimiento(f.movimiento, nombreCategoria);
}
