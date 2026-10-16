/**
 * Lógica pura del bloque "Comisión bancaria" del formulario de movimiento (sin React).
 * El cálculo vive en shared/types/comision-bancaria (ruta relativa: así también lo cargan los tests del backend).
 */
import {
  aplicaComisionBancaria, planificarComisionBancaria, type PlanComisionBancaria, type TipoMovimientoComision,
} from '../../../../shared/types/comision-bancaria.js';

/** Sin valor por defecto: '' = la persona aún no eligió. */
export type OpcionComision = '' | 'si' | 'no';

export function llevaDeOpcion(opcion: OpcionComision): boolean | null {
  return opcion === 'si' ? true : opcion === 'no' ? false : null;
}

/** Estado de la consulta "¿está habilitada la comisión bancaria?" (ver useComisionDisponible). */
export type EstadoComision = 'cargando' | 'error' | 'disponible' | 'no-disponible';

/** Respuesta del servicio -> estado. Un error de red NO equivale a "no disponible": el backend sigue exigiendo la elección. */
export function estadoDeConfig(r: { disponible: boolean } | { error: string }): EstadoComision {
  if ('error' in r) return 'error';
  return r.disponible ? 'disponible' : 'no-disponible';
}

export const TEXTO_MESA_SIN_COMISION_BANCARIA =
  'La mesa de cambio tiene su propia comisión; no se cobra la comisión bancaria 0.3%';

const MENSAJE_COMISION_CARGANDO = 'Verificando si este movimiento lleva comisión bancaria. Espera un momento para registrarlo.';
const MENSAJE_COMISION_ERROR =
  'No se pudo verificar la comisión bancaria, y las salidas desde una cuenta en Bs la exigen. Reintenta la verificación para poder registrar.';

interface EntradaOferta {
  /** La migración está aplicada (si no, el interruptor no se ofrece). */
  disponible: boolean;
  tipo: TipoMovimientoComision | '';
  moneda: string;
  /** Una transferencia con mesa de cambio tiene su propia comisión. */
  mesaActiva: boolean;
}

/** ¿Se muestra el interruptor? Solo en salidas desde una cuenta en Bs, sin mesa de cambio y con la migración aplicada. */
export function ofrecerComision(e: EntradaOferta): boolean {
  return e.disponible && !e.mesaActiva && e.tipo !== '' && aplicaComisionBancaria(e.tipo, e.moneda);
}

interface EntradaBloqueo {
  estado: EstadoComision;
  tipo: TipoMovimientoComision | '';
  moneda: string;
  mesaActiva: boolean;
}

/**
 * Mensaje que impide enviar mientras no se sepa si la comisión aplica: una salida desde una cuenta en Bs sin mesa
 * de cambio ESTÁ OBLIGADA a responder Sí/No, pero la pregunta solo se ofrece si la consulta terminó bien.
 * Null si no bloquea (disponible, no disponible, o el movimiento no lleva comisión de todos modos).
 */
export function bloqueoPorComision(e: EntradaBloqueo): string | null {
  if (e.mesaActiva || e.tipo === '' || !aplicaComisionBancaria(e.tipo, e.moneda)) return null;
  if (e.estado === 'cargando') return MENSAJE_COMISION_CARGANDO;
  if (e.estado === 'error') return MENSAJE_COMISION_ERROR;
  return null;
}

/** ¿Se muestra el aviso "la mesa de cambio tiene su propia comisión"? Solo donde sin mesa se habría ofrecido la comisión. */
export function mostrarAvisoMesaSinComision(e: EntradaOferta): boolean {
  return e.mesaActiva && ofrecerComision({ ...e, mesaActiva: false });
}

interface EntradaPlan {
  ofrecida: boolean;
  tipo: TipoMovimientoComision;
  moneda: string;
  monto: number;
  opcion: OpcionComision;
  saldo: number;
}

/** Plan de la comisión: si no se ofrece no pide nada; si se ofrece exige elegir y valida el saldo. */
export function planDeComision(e: EntradaPlan): PlanComisionBancaria {
  if (!e.ofrecida) return { ok: true, aplica: false, comision: 0, totalDebitado: e.monto };
  return planificarComisionBancaria({ tipo: e.tipo, moneda: e.moneda, monto: e.monto, lleva: llevaDeOpcion(e.opcion), saldo: e.saldo });
}
