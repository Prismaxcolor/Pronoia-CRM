import { supabaseAdmin } from '../config/supabase.js';
import type { FalloNomina } from '../utils/nomina-errores.js';
import { MENSAJE_PAGO_INDIVIDUAL_NO_HABILITADO } from '../utils/nomina-pago.js';
import type { PagarTrabajadorInput } from '../schemas/nomina.js';
import { obtenerNomina } from './nomina-service.js';
import {
  categoriaDePagoNomina, datosSql, estadoNoPagable, fallaRpc, planDePago, resultadoDe, MENSAJE_NOMINA_PAGADA_COMPLETA,
  type ResultadoPagoNomina,
} from './nomina-pago-service.js';

/**
 * Paga a UN trabajador de una nómina cerrada desde el Wallet (botón «Pagar» del renglón): UNA llamada a
 * nomina_pagar_trabajador (egresos del renglón, categoría, comisión, comprobantes y vínculo en una sola transacción).
 * Un trabajador con las dos partes (divisas y Bs) se paga con una cuenta por moneda. Reintentar es seguro: la BD bloquea la
 * nómina y devuelve yaPagada. La nómina completa y el pago por trabajador son excluyentes (la BD lo impone).
 */
export async function pagarTrabajadorNomina(
  nominaId: string, trabajadorId: string, input: PagarTrabajadorInput, userId: string,
): Promise<ResultadoPagoNomina | FalloNomina> {
  const previa = await obtenerNomina(nominaId);
  if ('error' in previa) return previa;
  const { nomina } = previa;
  // Primero el estado: una nómina ANULADA que tuvo pagos es 409, no "ya pagada".
  const rechazo = estadoNoPagable(nomina);
  if (rechazo) return rechazo;
  const linea = nomina.lineas.find(l => l.trabajadorId === trabajadorId);
  if (!linea) return { error: 'El trabajador no está en esta nómina.', codigo: 404 };
  if (nomina.pagos.some(p => p.trabajadorId === null)) return { error: MENSAJE_NOMINA_PAGADA_COMPLETA, codigo: 409 };
  if (nomina.pagos.some(p => p.trabajadorId === trabajadorId)) return { nomina, yaPagada: true };

  const plan = await planDePago({ lineas: [linea] }, input);
  if ('error' in plan) return plan;
  const categoria = await categoriaDePagoNomina(nomina.tipo);
  if ('error' in categoria) return categoria;

  const { data, error } = await supabaseAdmin.rpc('nomina_pagar_trabajador', {
    p_nomina_id: nominaId, p_trabajador_id: trabajadorId,
    p_datos: datosSql(input, categoria.categoria?.id ?? null, plan.pagos), p_usuario: userId,
  });
  if (error) return fallaRpc(error, MENSAJE_PAGO_INDIVIDUAL_NO_HABILITADO, 'nomina_pagar_trabajador');
  return resultadoDe(nomina, data, userId);
}
