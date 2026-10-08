import { apiFetch } from './api-client';
import { leerGet } from './lectura-service';
import { LIMITES_CACHE, recortarCampo, ultimasFilas } from '../lib/offline/lectura-logica';
import { obtenerCatalogo } from '../lib/offline/catalogos';
import type { Banca, Movimiento, TipoBanca } from '@shared/types/index.js';

export interface ObtenerBancasOpts {
  incluirArchivadas?: boolean;
}

export async function obtenerBancas(opts: ObtenerBancasOpts = {}): Promise<Banca[]> {
  try {
    const query = opts.incluirArchivadas ? '?incluirArchivadas=true' : '';
    const { datos } = await obtenerCatalogo(
      opts.incluirArchivadas ? 'bancas:todas' : 'bancas:activas',
      async () => {
        const { bancas } = await apiFetch<{ bancas: Banca[] }>(`/api/cochinito/bancas${query}`);
        return bancas;
      },
    );
    return datos;
  } catch {
    return [];
  }
}

export async function obtenerMovimientos(): Promise<Movimiento[]> {
  try {
    const { movimientos } = await leerGet<{ movimientos: Movimiento[] }>('/api/cochinito/movimientos', {
      recortar: d => recortarCampo(d, 'movimientos', f => ultimasFilas(f as Movimiento[], LIMITES_CACHE.maxMovimientos, m => m.fecha)),
    });
    return movimientos;
  } catch {
    return [];
  }
}

export interface CrearBancaInput {
  nombre: string;
  tipo: TipoBanca;
  moneda: string;
  descripcion: string;
  /** Clave de la paleta; null/omitido = sin color. */
  color?: string | null;
  /** Chat de Telegram de los avisos de la banca; null/omitido = grupo general de cajas. */
  telegramChatId?: string | null;
}

/** Crea una banca con saldo 0. Para establecer saldo inicial se debe registrar un ingreso. */
export async function crearBanca(input: CrearBancaInput): Promise<Banca | null> {
  try {
    const { banca } = await apiFetch<{ banca: Banca }>('/api/cochinito/bancas', {
      method: 'POST',
      body: input,
    });
    return banca;
  } catch (err) {
    console.error('Error al crear banca:', err);
    return null;
  }
}

export interface ActualizarBancaInput {
  nombre?: string;
  tipo?: TipoBanca;
  descripcion?: string;
  /** null quita el color. */
  color?: string | null;
  /** null vuelve al grupo general de cajas. */
  telegramChatId?: string | null;
}

export async function actualizarBanca(id: string, campos: ActualizarBancaInput): Promise<boolean> {
  try {
    await apiFetch(`/api/cochinito/bancas/${id}`, { method: 'PATCH', body: campos });
    return true;
  } catch {
    return false;
  }
}

export interface ArchivarBancaResult {
  ok: boolean;
  razon?: string;
}

/**
 * Archiva una banca (soft delete). Falla si tiene saldo distinto de 0.
 * No se permite borrar físicamente: la regla de dominio del CLAUDE.md es
 * "en finanzas NUNCA se borra; se reversa con un movimiento contrario".
 */
export async function archivarBanca(id: string): Promise<ArchivarBancaResult> {
  try {
    await apiFetch(`/api/cochinito/bancas/${id}/archivar`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    return { ok: false, razon: err instanceof Error ? err.message : 'No se pudo archivar la banca.' };
  }
}

export async function desarchivarBanca(id: string): Promise<boolean> {
  try {
    await apiFetch(`/api/cochinito/bancas/${id}/desarchivar`, { method: 'POST' });
    return true;
  } catch {
    return false;
  }
}

export interface CrearMovimientoInput {
  tipo: 'ingreso' | 'egreso' | 'transferencia';
  bancaId: string;
  /** Solo transferencia: banca que recibe los fondos. */
  bancaDestinoId?: string | null;
  monto: number;
  /** Solo transferencia entre monedas distintas: lo que entra a la banca destino. */
  montoDestino?: number | null;
  moneda: string;
  descripcion: string;
  referencia: string;
  fecha: string;
  registradoPor: string;
  /** Proveedor al que se le paga (egreso). Alimenta su estado de cuenta. */
  proveedorId?: string | null;
  /** Cliente del que se cobra (ingreso). Alimenta su estado de cuenta. */
  clienteId?: string | null;
  /** URLs de la imagen del comprobante (opcional), subidas con subirComprobantePago. */
  comprobantes?: string[];
}

/** Crea un movimiento de ingreso, egreso o transferencia. El trigger SQL ajusta el saldo. */
export async function crearMovimiento(input: CrearMovimientoInput): Promise<Movimiento | null> {
  try {
    const { movimiento } = await apiFetch<{ movimiento: Movimiento }>('/api/cochinito/movimientos', {
      method: 'POST',
      body: input,
    });
    return movimiento;
  } catch (err) {
    console.error('Error al crear movimiento:', err);
    return null;
  }
}

/** Movimiento con los nombres ya resueltos (bancas, tercero, quién lo registró y quién lo anuló). */
export interface DetalleMovimiento {
  movimiento: Movimiento;
  bancaOrigenNombre: string | null;
  bancaDestinoNombre: string | null;
  /** Solo viene con nombre si el usuario puede ver proveedores / clientes. */
  proveedorNombre: string | null;
  clienteNombre: string | null;
  registradoPorNombre: string | null;
  anuladoPorNombre: string | null;
}

/** Detalle de un movimiento; null si no existe, no hay permiso o falla la red. */
export async function obtenerDetalleMovimiento(id: string): Promise<DetalleMovimiento | null> {
  try {
    return await apiFetch<DetalleMovimiento>(`/api/cochinito/movimientos/${id}`);
  } catch {
    return null;
  }
}
