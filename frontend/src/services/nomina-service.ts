import { apiFetch } from './api-client';
import type {
  CargoTrabajador, EstadoPrestamo, Nomina, NominaResumen, NominaSemana, Prestamo, TipoPrestamo, TipoTrabajador, Trabajador,
} from '@shared/types/nomina';
import type { PayloadNomina } from '../features/nomina/nomina-editor';
import type { PayloadPago, PayloadPagoTrabajador } from '../features/nomina/nomina-pago';
import type { PayloadDesembolso } from '../features/nomina/nomina-desembolso';

/** Datos personales sensibles: solo en línea y sin caché local (no pasan por la lectura sin conexión). */
export interface TrabajadorInput {
  tipo: TipoTrabajador;
  nombres: string;
  apellidos: string;
  cedula: string;
  rif: string | null;
  telefono: string | null;
  direccion: string | null;
  puesto: string | null;
  contactoEmergenciaNombre: string | null;
  contactoEmergenciaTelefono: string | null;
  pagoMovilBanco: string | null;
  pagoMovilTelefono: string | null;
  pagoMovilCedula: string | null;
  binanceCorreoId: string | null;
  /** Sueldo diario en divisas (USD) y "en Bs" (valor en USD de referencia que se paga en bolívares a la tasa del día). */
  pagoDiarioUsd: number;
  pagoDiarioBs: number;
}

export interface PrestamoInput {
  trabajadorId: string;
  tipo: TipoPrestamo;
  montoUsd: number;
  cuotaSemanalUsd: number | null;
  fecha: string;
  nota: string | null;
  /** Si viene, además de registrar el préstamo se registra su pago desde el Wallet. */
  desembolso?: PayloadDesembolso;
}

export type Resultado<T> = T | { error: string };

async function ejecutar<T>(accion: () => Promise<T>, porDefecto: string): Promise<Resultado<T>> {
  try {
    return await accion();
  } catch (e) {
    return { error: e instanceof Error && e.message ? e.message : porDefecto };
  }
}

function consulta(params: Record<string, string | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== false) q.set(k, String(v));
  return q.size > 0 ? `?${q.toString()}` : '';
}

const BASE = '/api/nomina';

export const obtenerTrabajadores = (tipo?: TipoTrabajador, incluirInactivos = false) =>
  ejecutar(() => apiFetch<{ trabajadores: Trabajador[] }>(`${BASE}/trabajadores${consulta({ tipo, incluirInactivos })}`), 'No se pudo cargar el personal.');

/** Últimos movimientos del trabajador (pagos de nómina, préstamos, cuotas y reversas); los de Bs con su equivalente en USD. */
export const obtenerCargoTrabajador = (id: string) =>
  ejecutar(() => apiFetch<{ cargo: CargoTrabajador }>(`${BASE}/trabajadores/${id}/cargo`), 'No se pudo cargar el cargo del trabajador.');

export const crearTrabajador = (input: TrabajadorInput) =>
  ejecutar(() => apiFetch<{ trabajador: Trabajador }>(`${BASE}/trabajadores`, { method: 'POST', body: input }), 'No se pudo crear el trabajador.');

export const actualizarTrabajador = (id: string, input: Partial<TrabajadorInput> & { activo?: boolean }) =>
  ejecutar(() => apiFetch<{ trabajador: Trabajador }>(`${BASE}/trabajadores/${id}`, { method: 'PATCH', body: input }), 'No se pudo actualizar el trabajador.');

export const desactivarTrabajador = (id: string) =>
  ejecutar(() => apiFetch<{ ok: true }>(`${BASE}/trabajadores/${id}/desactivar`, { method: 'POST' }), 'No se pudo desactivar al trabajador.');

export const obtenerPrestamos = (filtro: { trabajadorId?: string; estado?: EstadoPrestamo } = {}) =>
  ejecutar(() => apiFetch<{ prestamos: Prestamo[] }>(`${BASE}/prestamos${consulta(filtro)}`), 'No se pudieron cargar los préstamos.');

/** `advertencia`: el préstamo se registró pero su pago no pudo registrarse (se reintenta con «Registrar pago»). */
export const crearPrestamo = (input: PrestamoInput) =>
  ejecutar(() => apiFetch<{ prestamo: Prestamo; advertencia?: string }>(`${BASE}/prestamos`, { method: 'POST', body: input }), 'No se pudo registrar el préstamo.');

export interface ResultadoPagoPrestamo {
  prestamo: Prestamo;
  /** true si el préstamo ya estaba pagado: no se creó ningún movimiento nuevo. */
  yaPagado: boolean;
  advertencia?: string;
}

/** Registra el pago (desembolso) de un préstamo ya creado desde el Wallet. */
export const pagarPrestamo = (id: string, payload: PayloadDesembolso) =>
  ejecutar(() => apiFetch<ResultadoPagoPrestamo>(`${BASE}/prestamos/${id}/pagar`, { method: 'POST', body: payload }), 'No se pudo registrar el pago del préstamo.');

export const actualizarPrestamo = (id: string, input: { cuotaSemanalUsd?: number | null; nota?: string | null }) =>
  ejecutar(() => apiFetch<{ prestamo: Prestamo }>(`${BASE}/prestamos/${id}`, { method: 'PATCH', body: input }), 'No se pudo actualizar el préstamo.');

export const anularPrestamo = (id: string, motivo: string) =>
  ejecutar(() => apiFetch<{ ok: true }>(`${BASE}/prestamos/${id}/anular`, { method: 'POST', body: { motivo } }), 'No se pudo anular el préstamo.');

export const obtenerNominas = (filtro: { tipo?: TipoTrabajador; desde?: string; hasta?: string } = {}) =>
  ejecutar(() => apiFetch<{ nominas: NominaResumen[] }>(`${BASE}/nominas${consulta(filtro)}`), 'No se pudo cargar el historial.');

export const obtenerNominaSemana = (tipo: TipoTrabajador, semana: string) =>
  ejecutar(() => apiFetch<NominaSemana>(`${BASE}/nominas/semana${consulta({ tipo, semana })}`), 'No se pudo cargar la nómina de la semana.');

export const guardarNomina = (payload: PayloadNomina) =>
  ejecutar(() => apiFetch<{ nomina: Nomina }>(`${BASE}/nominas`, { method: 'POST', body: payload }), 'No se pudo guardar la nómina.');

export const cerrarNomina = (id: string) =>
  ejecutar(() => apiFetch<{ nomina: Nomina; yaCerrada: boolean }>(`${BASE}/nominas/${id}/cerrar`, { method: 'POST' }), 'No se pudo cerrar la nómina.');

export const anularNomina = (id: string, motivo: string) =>
  ejecutar(() => apiFetch<{ nomina: Nomina }>(`${BASE}/nominas/${id}/anular`, { method: 'POST', body: { motivo } }), 'No se pudo anular la nómina.');

export interface ResultadoPagoNomina {
  nomina: Nomina;
  /** true si la nómina ya estaba pagada: no se creó ningún movimiento nuevo. */
  yaPagada: boolean;
  advertencia?: string;
}

/** Categoría del Wallet que llevará el egreso del pago de este tipo de personal; null = sin categoría asignada. */
export const obtenerCategoriaPagoNomina = (tipo: TipoTrabajador) =>
  ejecutar(
    () => apiFetch<{ categoria: { id: string; nombre: string } | null }>(`${BASE}/categoria-pago${consulta({ tipo })}`),
    'No se pudo consultar la categoría del pago.',
  );

/** Paga la nómina cerrada desde el Wallet: crea los egresos (uno por moneda) y los enlaza a la nómina. */
export const pagarNomina = (id: string, payload: PayloadPago) =>
  ejecutar(() => apiFetch<ResultadoPagoNomina>(`${BASE}/nominas/${id}/pagar`, { method: 'POST', body: payload }), 'No se pudo pagar la nómina.');

/** Paga a UN trabajador de la nómina cerrada desde el Wallet (botón «Pagar» del renglón), con comprobantes opcionales. */
export const pagarTrabajadorNomina = (id: string, trabajadorId: string, payload: PayloadPagoTrabajador) =>
  ejecutar(
    () => apiFetch<ResultadoPagoNomina>(`${BASE}/nominas/${id}/trabajadores/${trabajadorId}/pagar`, { method: 'POST', body: payload }),
    'No se pudo pagar al trabajador.',
  );
