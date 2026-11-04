import { estado } from './supabase-falso';

/** Entidades: dos proveedores vinculados (para comprobar que no se cruzan los chat_id),
 *  uno sin vincular y un cliente vinculado. */
export const P1 = '11111111-1111-4111-8111-111111111111';
export const P2 = '22222222-2222-4222-8222-222222222222';
export const P_SIN_VINCULAR = '33333333-3333-4333-8333-333333333333';
export const CL1 = '44444444-4444-4444-8444-444444444444';
export const GRUPO1 = '55555555-5555-4555-8555-555555555555';
export const GRUPO9 = '66666666-6666-4666-8666-666666666666';
export const CHAT_P1 = '1111';
export const CHAT_P2 = '2222';
export const CHAT_CL1 = '4444';

export function sembrarEntidades(): void {
  estado.tablas.proveedores = [
    { id: P1, nombre: 'Reciclados El Valle C.A.', telegram_chat_id: CHAT_P1 },
    { id: P2, nombre: 'Otro Proveedor', telegram_chat_id: CHAT_P2 },
    { id: P_SIN_VINCULAR, nombre: 'Sin Telegram', telegram_chat_id: null },
  ];
  estado.tablas.clientes = [{ id: CL1, nombre: 'Fundición Norte', telegram_chat_id: CHAT_CL1 }];
  estado.tablas.users = [{ id: 'U1', nombre: 'Operador Interno' }];
}

const URL_FOTO = (n: string) => `https://proyecto.supabase.co/storage/v1/object/public/tickets/${n}.jpg`;

export function filaTicket(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'T1', numero: 57, tipo: 'compra', entidad_id: P1, fecha: '2026-10-03', fotos: [], observaciones: null,
    facturado: false, created_at: '2026-10-03T15:00:00Z', peso_global: 1000, pesaje_exterior: false, devolucion: 0,
    fotos_devolucion: [URL_FOTO('dev1')], estado: 'completo', pesado_por: null, completado_por: null,
    completado_en: null, vehiculo: 'ZNA GRIS', ticket_principal_id: null,
    detalle_tickets_pesaje: [{
      id: 'D1', producto_id: 'PR1', subcategoria: null, peso_bruto: 600, tara: 50, devolucion: 0, peso_neto: 550,
      destino_tipo: 'mpp', lote_id: null, fotos: [URL_FOTO('mat1'), URL_FOTO('mat2')], productos: { nombre: 'Cobre' }, lotes: null,
    }],
    pesajes_globales: [{ id: 'G1', orden: 1, peso: 1000, tara: 100, fotos: [URL_FOTO('pg1')] }],
    ...extra,
  };
}

export function sembrarTicket(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const fila = filaTicket(extra);
  estado.tablas.tickets_pesaje = [fila];
  estado.tablas.vehiculos = [{ nombre: 'ZNA GRIS', fotos: [URL_FOTO('veh1')] }];
  return fila;
}

export function filaFactura(tipo: 'compra' | 'venta', extra: Record<string, unknown> = {}): Record<string, unknown> {
  const compra = tipo === 'compra';
  return {
    id: 'F1', numero: 3, proveedor_id: compra ? P1 : null, cliente_id: compra ? null : CL1, total: 500, monto_pagado: 0,
    descripcion: null, observaciones: null, estado: 'emitida', created_at: '2026-10-03T15:00:00Z',
    proveedores: compra ? { nombre: 'Reciclados El Valle C.A.' } : null,
    clientes: compra ? null : { nombre: 'Fundición Norte' },
    [compra ? 'detalle_facturas_compra' : 'detalle_facturas_venta']: [
      { id: 'I1', producto_id: 'PR1', peso: 100, precio_unitario: 5, subtotal: 500, descuento_kg: 0, productos: { nombre: 'Cobre' } },
    ],
    [compra ? 'facturas_compra_tickets' : 'facturas_venta_tickets']: [],
    ...extra,
  };
}

export function filaNota(tipo: 'proveedor' | 'cliente', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'N1', numero: 4, tipo: 'credito', monto: 50, motivo: 'Ajuste por diferencia de peso', anulada: false, pagada: false,
    fecha: '2026-10-03', registrado_por: 'U1', anula_nota_id: null, factura_id: null, anulada_at: null, anulada_por: null,
    anulada_motivo: null, created_at: '2026-10-03T15:00:00Z',
    [tipo === 'proveedor' ? 'proveedor_id' : 'cliente_id']: tipo === 'proveedor' ? P1 : CL1,
    ...extra,
  };
}

export function sembrarPago(tipo: 'proveedor' | 'cliente'): void {
  const prov = tipo === 'proveedor';
  estado.tablas.movimientos = [{
    id: 'M1', subtipo: prov ? 'pago' : 'cobro', numero: 7, grupo_id: GRUPO1, monto: 100, moneda: 'USD', monto_usd: 100,
    descripcion: null, referencia: 'REF-123', fecha: '2026-10-03T00:00:00Z', comprobantes: [], registrado_por: 'U1',
    banca_origen_id: 'B1', tipo: prov ? 'egreso' : 'ingreso', [prov ? 'proveedor_id' : 'cliente_id']: prov ? P1 : CL1,
  }];
  estado.tablas.bancas = [{ id: 'B1', nombre: 'Banesco USD' }];
  estado.tablas.pago_aplicaciones = [{ grupo_id: GRUPO1, tipo: 'factura', item_id: 'F1', monto_usd: 100 }];
  estado.tablas[prov ? 'facturas_compra' : 'facturas_venta'] = [{ id: 'F1', numero: 3 }];
}
