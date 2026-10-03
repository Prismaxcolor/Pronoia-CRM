// Verificación de solo lectura de los PDF que se mandan por Telegram. Para cada tipo de
// documento toma un ejemplo REAL de la BD (SELECT únicamente), ejecuta el mismo generador
// que usa el envío automático y confirma que produce un PDF válido y que los datos que
// salen en él son coherentes (montos, nombres, fechas). NO importa el servicio de envío:
// no llama a n8n, no sube nada a Storage y no escribe en la BD.
//
// Uso: npx tsx scripts/verificar-envios-telegram.ts   (o: npm run verificar:envios-telegram)
// Sale con código 1 si algún tipo de documento falla al generarse.

import { supabaseAdmin as sb } from '../src/config/supabase.js';
import { obtenerTicket } from '../src/services/ticket-pesaje-service.js';
import { obtenerFactura, type TipoFactura } from '../src/services/factura-service.js';
import { obtenerNotaAjuste } from '../src/services/nota-ajuste-service.js';
import { obtenerNotaAjusteCliente } from '../src/services/nota-ajuste-cliente-service.js';
import { obtenerPagoDetalle } from '../src/services/pago-detalle-service.js';
import { obtenerEstadoCuenta } from '../src/services/estado-cuenta-service.js';
import { aEstadoCuentaPortal } from '../src/services/portal-estado-cuenta.js';
import {
  generarFacturaPdf, generarTicketPdf, nombreArchivoFactura, nombreArchivoTicket,
} from '../src/services/document-generator.js';
import {
  generarEstadoCuentaPdf, generarNotaPdf, generarPagoPdf, nombreArchivoEstadoCuenta, nombreArchivoNota, nombreArchivoPago,
} from '../src/services/document-generator-financiero.js';
import { fotosDeTicket } from '../src/services/telegram-eventos-service.js';

type Resultado = { documento: string; ejemplo: string; estado: 'OK' | 'AVISO' | 'FALLA' | 'SIN DATOS'; detalle: string };
const resultados: Resultado[] = [];

const esPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-' && b.length > 1000;
const redondear = (n: number) => Math.round(n * 100) / 100;

async function verificar(documento: string, ejemplo: string, fn: () => Promise<{ avisos: string[]; detalle: string } | null>): Promise<void> {
  try {
    const r = await fn();
    if (!r) resultados.push({ documento, ejemplo, estado: 'SIN DATOS', detalle: 'No hay un registro de este tipo en la BD para probar.' });
    else resultados.push({ documento, ejemplo, estado: r.avisos.length ? 'AVISO' : 'OK', detalle: [r.detalle, ...r.avisos].join(' | ') });
  } catch (err) {
    resultados.push({ documento, ejemplo, estado: 'FALLA', detalle: err instanceof Error ? err.message : String(err) });
  }
}

function pdfValido(buffer: Buffer): string[] {
  return esPdf(buffer) ? [] : ['el PDF generado no es válido'];
}

async function ultimo(tabla: string, filtros: Record<string, unknown> = {}, columnas = 'id'): Promise<Record<string, unknown> | null> {
  let q = sb.from(tabla).select(columnas).order('created_at', { ascending: false }).limit(1);
  for (const [k, v] of Object.entries(filtros)) q = q.eq(k, v);
  const { data } = await q;
  return ((data as unknown as Array<Record<string, unknown>> | null) ?? [])[0] ?? null;
}

// --- ticket de pesaje --------------------------------------------------------
for (const tipo of ['compra', 'venta'] as const) {
  await verificar(`Ticket de pesaje (${tipo})`, 'último completo', async () => {
    const fila = await ultimo('tickets_pesaje', { tipo, estado: 'completo' }, 'id, entidad_id');
    if (!fila) return null;
    const t = await obtenerTicket(String(fila.id));
    if (!t) throw new Error('obtenerTicket devolvió null');
    const tabla = tipo === 'compra' ? 'proveedores' : 'clientes';
    const { data: ent } = await sb.from(tabla).select('nombre').eq('id', t.entidadId ?? '').maybeSingle();
    const nombre = (ent as { nombre: string } | null)?.nombre;
    const avisos = [...pdfValido(generarTicketPdf(t, nombre ?? "—"))];
    if (!nombre) avisos.push('el ticket no tiene entidad con nombre');
    const sumaNetos = redondear(t.materiales.reduce((a, m) => a + m.pesoNeto, 0));
    if (Math.abs(sumaNetos - t.pesoNetoTotal) > 0.01) avisos.push(`peso neto total ${t.pesoNetoTotal} != suma de materiales ${sumaNetos}`);
    for (const m of t.materiales) {
      if (Math.abs(redondear(m.pesoBruto - m.tara - m.devolucion) - m.pesoNeto) > 0.01) avisos.push(`material ${m.nombreProducto ?? '—'}: bruto - tara != neto`);
    }
    const { data: veh } = t.vehiculo ? await sb.from('vehiculos').select('fotos').eq('nombre', t.vehiculo).maybeSingle() : { data: null };
    const fotos = fotosDeTicket(t, ((veh as { fotos: string[] } | null)?.fotos) ?? []);
    return { avisos, detalle: `${nombreArchivoTicket(t)}; ${t.materiales.length} materiales; ${fotos.length} fotos a enviar` };
  });
}

// --- facturas ----------------------------------------------------------------
for (const tipo of ['compra', 'venta'] as TipoFactura[]) {
  for (const estadoFactura of ['emitida', 'anulada']) {
    await verificar(`Factura de ${tipo} (${estadoFactura})`, 'última', async () => {
      const fila = await ultimo(tipo === 'compra' ? 'facturas_compra' : 'facturas_venta', { estado: estadoFactura });
      if (!fila) return null;
      const f = await obtenerFactura(tipo, String(fila.id));
      if (!f) throw new Error('obtenerFactura devolvió null');
      const avisos = pdfValido(generarFacturaPdf(f));
      const suma = redondear(f.items.reduce((a, i) => a + i.subtotal, 0));
      if (Math.abs(suma - f.total) > 0.01) avisos.push(`total ${f.total} != suma de ítems ${suma}`);
      if (!f.nombreEntidad) avisos.push('la factura no trae nombre de entidad');
      return { avisos, detalle: `${nombreArchivoFactura(f)}; total ${f.total}` };
    });
  }
}

// --- notas -------------------------------------------------------------------
for (const entidad of ['proveedor', 'cliente'] as const) {
  for (const anulada of [false, true]) {
    await verificar(`Nota de ${entidad} (${anulada ? 'anulada' : 'vigente'})`, 'última', async () => {
      const tabla = entidad === 'proveedor' ? 'notas_ajuste_proveedor' : 'notas_ajuste_cliente';
      const col = entidad === 'proveedor' ? 'proveedor_id' : 'cliente_id';
      const fila = await ultimo(tabla, { anulada }, `id, ${col}`);
      if (!fila) return null;
      const entidadId = String(fila[col]);
      const nota = entidad === 'proveedor'
        ? await obtenerNotaAjuste(entidadId, String(fila.id))
        : await obtenerNotaAjusteCliente(entidadId, String(fila.id));
      if ('error' in nota) throw new Error(nota.error);
      const avisos = pdfValido(generarNotaPdf(nota, entidad === 'proveedor' ? (nota as { nombreProveedor: string }).nombreProveedor : (nota as { nombreCliente: string }).nombreCliente, entidad === 'proveedor'));
      if (!(nota.monto > 0)) avisos.push('monto no positivo');
      if (anulada && !nota.anuladaMotivo) avisos.push('nota anulada sin motivo de anulación');
      return { avisos, detalle: `${nombreArchivoNota(nota)}; monto ${nota.monto}` };
    });
  }
}

// --- pagos / cobros / cruces -------------------------------------------------
async function ejemploPago(entidad: 'proveedor' | 'cliente', subtipos: string[]): Promise<{ entidadId: string; grupoId: string } | null> {
  const col = entidad === 'proveedor' ? 'proveedor_id' : 'cliente_id';
  const { data } = await sb.from('movimientos').select(`id, grupo_id, ${col}`).in('subtipo', subtipos).not(col, 'is', null).order('creado_en', { ascending: false }).limit(1);
  const fila = ((data as unknown as Array<Record<string, unknown>> | null) ?? [])[0];
  return fila ? { entidadId: String(fila[col]), grupoId: String(fila.grupo_id ?? fila.id) } : null;
}

async function ejemploCruce(entidad: 'proveedor' | 'cliente'): Promise<{ entidadId: string; grupoId: string } | null> {
  const col = entidad === 'proveedor' ? 'proveedor_id' : 'cliente_id';
  const { data } = await sb.from('cruces').select(`grupo_id, ${col}`).not(col, 'is', null).order('created_at', { ascending: false }).limit(1);
  const fila = ((data as unknown as Array<Record<string, unknown>> | null) ?? [])[0];
  return fila ? { entidadId: String(fila[col]), grupoId: String(fila.grupo_id) } : null;
}

const casosPago: Array<[string, 'proveedor' | 'cliente', () => Promise<{ entidadId: string; grupoId: string } | null>]> = [
  ['Pago a proveedor (PG-)', 'proveedor', () => ejemploPago('proveedor', ['pago'])],
  ['Adelanto a proveedor (AD-)', 'proveedor', () => ejemploPago('proveedor', ['adelanto'])],
  ['Cruce de proveedor (CR-)', 'proveedor', () => ejemploCruce('proveedor')],
  ['Cobro a cliente (CB-)', 'cliente', () => ejemploPago('cliente', ['cobro'])],
  ['Anticipo de cliente (AC-)', 'cliente', () => ejemploPago('cliente', ['anticipo'])],
  ['Cruce de cliente (CRV-)', 'cliente', () => ejemploCruce('cliente')],
];
for (const [nombre, entidad, buscar] of casosPago) {
  await verificar(nombre, 'último', async () => {
    const ej = await buscar();
    if (!ej) return null;
    const pago = await obtenerPagoDetalle(entidad, ej.entidadId, ej.grupoId);
    if ('error' in pago) throw new Error(pago.error);
    const avisos = pdfValido(generarPagoPdf(pago));
    if (pago.codigoCruce == null && pago.bancas.length === 0) avisos.push('pago sin bancas');
    if (pago.codigoPago == null && pago.codigoAdelanto == null && pago.codigoCruce == null) avisos.push('sin correlativo (PG-/AD-/CR-)');
    return { avisos, detalle: `${nombreArchivoPago(pago)}; total ${pago.totalUsd}; ${pago.items.length} ítems; ${pago.comprobantes.length} fotos de comprobante` };
  });
}

// --- estado de cuenta --------------------------------------------------------
for (const entidad of ['proveedor', 'cliente'] as const) {
  await verificar(`Estado de cuenta (${entidad})`, 'entidad de la última factura', async () => {
    // La entidad de la última factura: una con movimientos reales (no un proveedor de prueba vacío).
    const col = entidad === 'proveedor' ? 'proveedor_id' : 'cliente_id';
    const fila = await ultimo(entidad === 'proveedor' ? 'facturas_compra' : 'facturas_venta', {}, col);
    if (!fila) return null;
    const estado = await obtenerEstadoCuenta(entidad, String(fila[col]));
    if (!estado) throw new Error('obtenerEstadoCuenta devolvió null');
    const externo = aEstadoCuentaPortal(estado);
    const hoy = new Date().toISOString().slice(0, 10);
    const avisos = pdfValido(generarEstadoCuentaPdf(externo, hoy));
    if (Math.abs(redondear(estado.totales.facturado - estado.totales.pagado) - estado.totales.saldo) > 0.01 && estado.entradas.every(e => e.tipo !== 'nota_debito' && e.tipo !== 'nota_credito')) {
      avisos.push('saldo != facturado - pagado');
    }
    return { avisos, detalle: `${nombreArchivoEstadoCuenta(externo, hoy)}; ${externo.entradas.length} entradas; saldo ${estado.totales.saldo}` };
  });
}

// --- vinculación -------------------------------------------------------------
const { count: provVinc } = await sb.from('proveedores').select('id', { count: 'exact', head: true }).not('telegram_chat_id', 'is', null);
const { count: cliVinc } = await sb.from('clientes').select('id', { count: 'exact', head: true }).not('telegram_chat_id', 'is', null);

console.log('\nVerificación de documentos de Telegram (solo lectura, no se envió nada)\n');
for (const r of resultados) console.log(`[${r.estado.padEnd(9)}] ${r.documento.padEnd(36)} ${r.detalle}`);
console.log(`\nEntidades vinculadas a Telegram: ${provVinc ?? 0} proveedores, ${cliVinc ?? 0} clientes`);

const fallas = resultados.filter(r => r.estado === 'FALLA').length;
const avisos = resultados.filter(r => r.estado === 'AVISO').length;
const sinDatos = resultados.filter(r => r.estado === 'SIN DATOS').length;
console.log(`Resumen: ${resultados.length - fallas - avisos - sinDatos} OK, ${avisos} con aviso, ${sinDatos} sin datos, ${fallas} con falla`);
process.exit(fallas > 0 ? 1 : 0);
