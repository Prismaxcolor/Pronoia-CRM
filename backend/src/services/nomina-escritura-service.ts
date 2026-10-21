import { supabaseAdmin } from '../config/supabase.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import { armarNomina, MENSAJE_FALTA_TASA, mensajeNegativos, nombreCompleto, payloadGuardado } from '../utils/nomina-armado.js';
import { validarCuotas, type PrestamoVigente } from '../utils/nomina-calculo.js';
import { trocear } from '../utils/paginacion.js';
import type { Nomina } from '../../../shared/types/nomina.js';
import type { GuardarNominaInput } from '../schemas/nomina.js';
import { obtenerNomina } from './nomina-service.js';

const IDS_POR_LOTE = 100;

export const MENSAJE_CIERRE_CON_NEGATIVOS =
  'No se puede cerrar la nómina: hay trabajadores con un total a pagar negativo. Corrige los descuentos o los montos de esos renglones y guarda de nuevo.';

type Fila = Record<string, unknown>;

/** Lee filas por id en lotes (las URLs de PostgREST no admiten listas enormes). */
async function leerPorIds(tabla: string, columnas: string, ids: readonly string[]): Promise<{ filas: Fila[] } | FalloNomina> {
  const lotes = await Promise.all(trocear(ids, IDS_POR_LOTE).map(trozo => supabaseAdmin.from(tabla).select(columnas).in('id', trozo)));
  const error = lotes.find(l => l.error)?.error;
  if (error) return falloNomina(error, `leer_${tabla}`, 'No se pudo validar la nómina.');
  return { filas: lotes.flatMap(l => (l.data ?? []) as unknown as Fila[]) };
}

/** Comprueba que los trabajadores existan y sean del tipo de la nómina; devuelve sus nombres. */
async function nombresDeTrabajadores(input: GuardarNominaInput): Promise<{ nombres: Map<string, string> } | FalloNomina> {
  const r = await leerPorIds('nomina_trabajadores', 'id, nombres, apellidos, tipo, activo', input.lineas.map(l => l.trabajadorId));
  if ('error' in r) return r;
  if (r.filas.length !== input.lineas.length) return { error: 'Hay trabajadores que no existen.', codigo: 400 };
  if (r.filas.some(t => t.tipo !== input.tipo)) {
    return { error: 'Hay trabajadores que no corresponden a este tipo de personal.', codigo: 400 };
  }
  if (r.filas.some(t => t.activo === false)) {
    return { error: 'Hay trabajadores inactivos en la nómina: quítalos para guardar.', codigo: 400 };
  }
  const nombres = new Map(r.filas.map(t => [t.id as string, nombreCompleto({ nombres: t.nombres as string, apellidos: t.apellidos as string })]));
  return { nombres };
}

/** Comprueba que las cuotas de préstamo estén dentro del saldo vigente (la BD lo vuelve a comprobar al guardar y al cerrar). */
async function validarPrestamos(input: GuardarNominaInput): Promise<FalloNomina | null> {
  const ids = [...new Set(input.lineas.flatMap(l => l.cuotas.map(c => c.prestamoId)))];
  if (ids.length === 0) return null;
  const r = await leerPorIds('nomina_prestamos', 'id, trabajador_id, saldo_usd, estado', ids);
  if ('error' in r) return r;
  const vigentes: PrestamoVigente[] = r.filas.map(p => ({
    id: p.id as string, trabajadorId: p.trabajador_id as string, saldoUsd: Number(p.saldo_usd), estado: p.estado as string,
  }));
  const problema = validarCuotas(input.lineas, vigentes);
  return problema ? { error: problema, codigo: 409 } : null;
}

/** Crea o reemplaza el borrador de (tipo, semana). Los totales se recalculan aquí; lo que mande el navegador se ignora. */
export async function guardarNomina(input: GuardarNominaInput, userId: string): Promise<{ nomina: Nomina } | FalloNomina> {
  const trabajadores = await nombresDeTrabajadores(input);
  if ('error' in trabajadores) return trabajadores;
  const prestamos = await validarPrestamos(input);
  if (prestamos) return prestamos;

  const armada = armarNomina(input, trabajadores.nombres);
  if (armada.faltaTasa) return { error: MENSAJE_FALTA_TASA, codigo: 400 };
  if (armada.negativas.length > 0 && !input.confirmarNegativos) {
    return { error: mensajeNegativos(armada.negativas.length), codigo: 422, extra: { lineasNegativas: armada.negativas } };
  }
  const { data, error } = await supabaseAdmin.rpc('nomina_guardar', { p_datos: payloadGuardado(input, armada), p_usuario: userId });
  if (error || !data) return falloNomina(error, 'nomina_guardar', 'No se pudo guardar la nómina.');
  return obtenerNomina(data as string);
}

/** Cierra la nómina: descuenta las cuotas y baja los saldos en una sola transacción. Reintentar es seguro (yaCerrada). */
export async function cerrarNomina(id: string, userId: string): Promise<{ nomina: Nomina; yaCerrada: boolean } | FalloNomina> {
  // Un total negativo solo se tolera en borrador: se cierra únicamente con todos los renglones en cero o más.
  // (nomina_cerrar lo vuelve a comprobar en la BD; este aviso llega antes y sin tocar nada.)
  const previa = await obtenerNomina(id);
  if ('nomina' in previa && previa.nomina.estado === 'BORRADOR' && previa.nomina.lineas.some(l => l.totalUsd < 0)) {
    return { error: MENSAJE_CIERRE_CON_NEGATIVOS, codigo: 409 };
  }
  const { data, error } = await supabaseAdmin.rpc('nomina_cerrar', { p_nomina_id: id, p_usuario: userId });
  if (error) return falloNomina(error, 'nomina_cerrar', 'No se pudo cerrar la nómina.');
  const r = await obtenerNomina(id);
  if ('error' in r) return r;
  return { nomina: r.nomina, yaCerrada: Boolean((data as { yaCerrada?: boolean } | null)?.yaCerrada) };
}

/** Anula con motivo; si estaba cerrada, la BD devuelve las cuotas al saldo de cada préstamo. */
export async function anularNomina(id: string, motivo: string, userId: string): Promise<{ nomina: Nomina } | FalloNomina> {
  const { error } = await supabaseAdmin.rpc('nomina_anular', { p_nomina_id: id, p_motivo: motivo, p_usuario: userId });
  if (error) return falloNomina(error, 'nomina_anular', 'No se pudo anular la nómina.');
  return obtenerNomina(id);
}
