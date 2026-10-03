/**
 * Herramientas de consulta de DINERO de BLOB (facturas, saldos, bancas, movimientos, notas).
 * Solo lectura. Cada una exige el permiso del módulo equivalente de la app:
 * facturacion, cochinito (bancas/movimientos), proveedores y clientes (saldos y notas).
 *
 * Nunca se devuelven: descripciones/observaciones libres, referencias bancarias, números de
 * cuenta, comprobantes ni datos de contacto de proveedores/clientes.
 */
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { obtenerEstadoCuenta, type TipoEntidad } from '../services/estado-cuenta-service.js';
import { listarBancas } from '../services/banca-service.js';
import {
  definirHerramienta,
  fechaSchema,
  limiteEfectivo,
  limiteSchema,
  patronBusqueda,
  redondear,
  textoSeguro,
  type HerramientaAsistente,
} from './asistente-herr-base.js';
import {
  formatCodigoCompra,
  formatCodigoNotaCredito,
  formatCodigoNotaCreditoCliente,
  formatCodigoNotaDebito,
  formatCodigoNotaDebitoCliente,
  formatCodigoVenta,
} from './codigos.js';
import type { Permiso } from './permisos.js';

const MONEDA_FACTURAS = 'USD';
const ESTADOS_FACTURA_VIGENTE = ['emitida', 'pagada'];
const MAX_FACTURAS_RESUMEN = 1000;
const ENTRADAS_ESTADO_CUENTA = 5;

const dinero = (n: unknown): number => redondear(n, 2);
const sumar = (valores: unknown[]): number => valores.reduce<number>((a, v) => a + (Number(v) || 0), 0);

// ---------------------------------------------------------------------------
// Facturas (permiso facturacion)
// ---------------------------------------------------------------------------

interface FacturaFila {
  numero: number | null;
  total: number;
  monto_pagado: number | null;
  estado: string;
  created_at: string;
  proveedor_id?: string | null;
  cliente_id?: string | null;
}

type TipoFactura = 'compra' | 'venta';
const TABLA_FACTURAS: Record<TipoFactura, 'facturas_compra' | 'facturas_venta'> = {
  compra: 'facturas_compra',
  venta: 'facturas_venta',
};
const COLUMNA_ENTIDAD: Record<TipoFactura, 'proveedor_id' | 'cliente_id'> = { compra: 'proveedor_id', venta: 'cliente_id' };
const TABLA_ENTIDAD: Record<TipoFactura, 'proveedores' | 'clientes'> = { compra: 'proveedores', venta: 'clientes' };

const pendiente = (f: FacturaFila): number => Math.max(Number(f.total) - Number(f.monto_pagado ?? 0), 0);

async function idsPorNombre(tabla: 'proveedores' | 'clientes', nombre: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from(tabla).select('id').ilike('nombre', patronBusqueda(nombre)).limit(30);
  return ((data ?? []) as Array<{ id: string }>).map(r => r.id);
}

async function nombresPorId(tabla: 'proveedores' | 'clientes' | 'bancas', ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();
  const { data } = await supabaseAdmin.from(tabla).select('id, nombre').in('id', unicos);
  return new Map(((data ?? []) as Array<{ id: string; nombre: string }>).map(r => [r.id, textoSeguro(r.nombre)]));
}

const facturasSchema = z.object({
  tipo: z.enum(['compra', 'venta']).describe('compra = a proveedores; venta = a clientes.'),
  estado: z.enum(['emitida', 'pagada']).optional().describe("'emitida' = pendiente de pago; 'pagada' = saldada."),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  entidad: z.string().max(60).optional().describe('Parte del nombre del proveedor/cliente.'),
  limite: limiteSchema,
});

export const consultarFacturas = definirHerramienta({
  nombre: 'consultar_facturas',
  etiqueta: 'facturas',
  descripcion: `Facturas de compra o venta recientes (monto total, pagado y pendiente en ${MONEDA_FACTURAS}). Filtra por estado, fechas o nombre del proveedor/cliente.`,
  parametros: facturasSchema,
  permisos: [{ recurso: 'facturacion', accion: 'ver' }],
  async ejecutar({ tipo, estado, desde, hasta, entidad, limite }) {
    let ids: string[] | null = null;
    if (entidad) {
      ids = await idsPorNombre(TABLA_ENTIDAD[tipo], entidad);
      if (ids.length === 0) return { filas: 0, datos: { fuente: 'facturación', facturas: [], nota: 'No encontré a nadie con ese nombre.' } };
    }
    const col = COLUMNA_ENTIDAD[tipo];
    let q = supabaseAdmin
      .from(TABLA_FACTURAS[tipo])
      .select(`numero, total, monto_pagado, estado, created_at, ${col}`)
      .in('estado', estado ? [estado] : ESTADOS_FACTURA_VIGENTE)
      .order('created_at', { ascending: false })
      .limit(limiteEfectivo(limite));
    if (desde) q = q.gte('created_at', desde);
    if (hasta) q = q.lte('created_at', `${hasta}T23:59:59`);
    if (ids) q = q.in(col, ids);
    const { data } = await q;
    const facturas = (data ?? []) as unknown as FacturaFila[];
    const nombres = await nombresPorId(TABLA_ENTIDAD[tipo], facturas.map(f => String(f[col] ?? '')).filter(Boolean));
    const formato = tipo === 'compra' ? formatCodigoCompra : formatCodigoVenta;
    const filas = facturas.map(f => ({
      factura: f.numero != null ? formato(f.numero) : null,
      fecha: f.created_at.slice(0, 10),
      [tipo === 'compra' ? 'proveedor' : 'cliente']: nombres.get(String(f[col] ?? '')) ?? null,
      estado: f.estado,
      totalUsd: dinero(f.total),
      pagadoUsd: dinero(f.monto_pagado),
      pendienteUsd: dinero(pendiente(f)),
    }));
    return { filas: filas.length, datos: { fuente: 'facturación', moneda: MONEDA_FACTURAS, facturas: filas } };
  },
});

const resumenFacturacionSchema = z.object({
  desde: fechaSchema.optional().describe('Por defecto, hoy.'),
  hasta: fechaSchema.optional().describe('Por defecto, igual a desde.'),
});

async function resumenTipo(tipo: TipoFactura, desde: string, hasta: string) {
  const tabla = TABLA_FACTURAS[tipo];
  const [periodo, abiertas] = await Promise.all([
    supabaseAdmin
      .from(tabla)
      .select('total, monto_pagado, estado, created_at')
      .in('estado', ESTADOS_FACTURA_VIGENTE)
      .gte('created_at', desde)
      .lte('created_at', `${hasta}T23:59:59`)
      .limit(MAX_FACTURAS_RESUMEN),
    supabaseAdmin.from(tabla).select('total, monto_pagado').eq('estado', 'emitida').limit(MAX_FACTURAS_RESUMEN),
  ]);
  const del = (periodo.data ?? []) as unknown as FacturaFila[];
  const pend = (abiertas.data ?? []) as unknown as FacturaFila[];
  return {
    periodo: { facturas: del.length, totalUsd: dinero(sumar(del.map(f => f.total))) },
    pendientesDePagoEnGeneral: { facturas: pend.length, montoPendienteUsd: dinero(sumar(pend.map(pendiente))) },
  };
}

export const resumenFacturacion = definirHerramienta({
  nombre: 'resumen_facturacion',
  etiqueta: 'resumen de facturación',
  descripcion: `Total facturado en compras y ventas del período (por defecto hoy, en ${MONEDA_FACTURAS}) y lo que está pendiente de pago en general.`,
  parametros: resumenFacturacionSchema,
  permisos: [{ recurso: 'facturacion', accion: 'ver' }],
  async ejecutar({ desde, hasta }, ctx) {
    const d = desde ?? ctx.hoy;
    const h = hasta ?? desde ?? ctx.hoy;
    const [compras, ventas] = await Promise.all([resumenTipo('compra', d, h), resumenTipo('venta', d, h)]);
    return {
      filas: compras.periodo.facturas + ventas.periodo.facturas,
      datos: { fuente: 'facturación', moneda: MONEDA_FACTURAS, desde: d, hasta: h, compras, ventas },
    };
  },
});

// ---------------------------------------------------------------------------
// Proveedores / clientes (permisos proveedores o clientes)
// ---------------------------------------------------------------------------

const buscarSchema = z.object({
  nombre: z.string().min(1).max(60).describe('Parte del nombre.'),
  limite: limiteSchema,
});
const saldoSchema = z.object({ nombre: z.string().min(1).max(60).describe('Nombre (o parte) del proveedor/cliente.') });
const notasSchema = z.object({
  entidad: z.string().max(60).optional().describe('Parte del nombre del proveedor/cliente.'),
  incluirAnuladas: z.boolean().optional().describe('Por defecto solo las vigentes.'),
  limite: limiteSchema,
});

interface Perfil {
  tipo: TipoEntidad;
  tabla: 'proveedores' | 'clientes';
  singular: 'proveedor' | 'cliente';
  plural: 'proveedores' | 'clientes';
  tablaNotas: 'notas_ajuste_proveedor' | 'notas_ajuste_cliente';
  columnaNotas: 'proveedor_id' | 'cliente_id';
  permiso: Permiso;
  codigoNota: (tipo: string, numero: number) => string;
}

const PERFIL_PROVEEDOR: Perfil = {
  tipo: 'proveedor',
  tabla: 'proveedores',
  singular: 'proveedor',
  plural: 'proveedores',
  tablaNotas: 'notas_ajuste_proveedor',
  columnaNotas: 'proveedor_id',
  permiso: { recurso: 'proveedores', accion: 'ver' },
  codigoNota: (t, n) => (t === 'credito' ? formatCodigoNotaCredito(n) : formatCodigoNotaDebito(n)),
};
const PERFIL_CLIENTE: Perfil = {
  tipo: 'cliente',
  tabla: 'clientes',
  singular: 'cliente',
  plural: 'clientes',
  tablaNotas: 'notas_ajuste_cliente',
  columnaNotas: 'cliente_id',
  permiso: { recurso: 'clientes', accion: 'ver' },
  codigoNota: (t, n) => (t === 'credito' ? formatCodigoNotaCreditoCliente(n) : formatCodigoNotaDebitoCliente(n)),
};

/** Resuelve un nombre a UNA entidad; si es ambiguo o no existe, devuelve las opciones. */
async function resolverEntidad(p: Perfil, nombre: string) {
  const { data } = await supabaseAdmin
    .from(p.tabla)
    .select('id, nombre')
    .ilike('nombre', patronBusqueda(nombre))
    .limit(6);
  const filas = (data ?? []) as Array<{ id: string; nombre: string }>;
  const exacta = filas.filter(f => f.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
  const elegida = filas.length === 1 ? filas[0] : exacta.length === 1 ? exacta[0] : undefined;
  return { elegida, opciones: filas.map(f => textoSeguro(f.nombre)) };
}

const CODIGO_CORRELATIVO = /^(?:PG|AD|NC|ND|CB|AC|NCV|NDV|CR|CRV|TR|C|V)-\d{4,9}$/;

/** Devuelve la referencia solo si es un código correlativo válido (PG-0001, NC-0003...); si no, null. */
export function codigoCorrelativo(valor: unknown): string | null {
  return typeof valor === 'string' && CODIGO_CORRELATIVO.test(valor) ? valor : null;
}

function herramientasDeEntidad(p: Perfil): HerramientaAsistente[] {
  const buscar = definirHerramienta({
    nombre: `buscar_${p.singular}`,
    etiqueta: p.plural,
    descripcion: `Busca ${p.plural} por nombre (solo nombre y si está activo; sin datos de contacto).`,
    parametros: buscarSchema,
    permisos: [p.permiso],
    async ejecutar({ nombre, limite }) {
      const { data } = await supabaseAdmin
        .from(p.tabla)
        .select('nombre, activo')
        .ilike('nombre', patronBusqueda(nombre))
        .order('nombre')
        .limit(limiteEfectivo(limite));
      const filas = ((data ?? []) as Array<{ nombre: string; activo: boolean }>).map(r => ({
        nombre: textoSeguro(r.nombre),
        activo: Boolean(r.activo),
      }));
      return { filas: filas.length, datos: { fuente: p.plural, [p.plural]: filas } };
    },
  });

  const saldo = definirHerramienta({
    nombre: `saldo_${p.singular}`,
    etiqueta: `estado de cuenta de ${p.singular}`,
    descripcion: `Estado de cuenta resumido de un ${p.singular} (en ${MONEDA_FACTURAS}): facturado, ${p.tipo === 'proveedor' ? 'pagado' : 'cobrado'}, saldo y sus últimos movimientos.`,
    parametros: saldoSchema,
    permisos: [p.permiso],
    async ejecutar({ nombre }) {
      const { elegida, opciones } = await resolverEntidad(p, nombre);
      if (!elegida) {
        return {
          filas: 0,
          datos: {
            fuente: `estado de cuenta (${p.singular})`,
            error: opciones.length === 0 ? `No encontré ese ${p.singular}.` : `Hay varios ${p.plural} con ese nombre; pregunta cuál.`,
            posibles: opciones,
          },
        };
      }
      const estado = await obtenerEstadoCuenta(p.tipo, elegida.id);
      if (!estado) return { filas: 0, datos: { fuente: `estado de cuenta (${p.singular})`, error: 'No pude armar el estado de cuenta.' } };
      const recientes = [...estado.entradas]
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
        .slice(0, ENTRADAS_ESTADO_CUENTA)
        .map(e => ({
          fecha: e.fecha.slice(0, 10),
          tipo: e.tipo,
          // Solo el código correlativo interno; la referencia libre (bancaria/comprobante) nunca sale.
          ...(codigoCorrelativo(e.referencia) ? { referencia: codigoCorrelativo(e.referencia) } : {}),
          cargoUsd: dinero(e.cargo),
          abonoUsd: dinero(e.abono),
        }));
      return {
        filas: recientes.length,
        datos: {
          fuente: `estado de cuenta (${p.singular})`,
          moneda: MONEDA_FACTURAS,
          [p.singular]: textoSeguro(estado.entidad.nombre),
          facturadoUsd: dinero(estado.totales.facturado),
          [p.tipo === 'proveedor' ? 'pagadoUsd' : 'cobradoUsd']: dinero(estado.totales.pagado),
          saldoUsd: dinero(estado.totales.saldo),
          ultimosMovimientos: recientes,
        },
      };
    },
  });

  const notas = definirHerramienta({
    nombre: `consultar_notas_${p.singular}`,
    etiqueta: `notas de crédito/débito de ${p.plural}`,
    descripcion: `Notas de crédito y débito vigentes de ${p.plural} (número, tipo, monto en ${MONEDA_FACTURAS}, fecha, si ya se pagó). Sin el motivo.`,
    parametros: notasSchema,
    permisos: [p.permiso],
    async ejecutar({ entidad, incluirAnuladas, limite }) {
      let ids: string[] | null = null;
      if (entidad) {
        ids = await idsPorNombre(p.tabla, entidad);
        if (ids.length === 0) return { filas: 0, datos: { fuente: 'notas', notas: [], nota: 'No encontré a nadie con ese nombre.' } };
      }
      let q = supabaseAdmin
        .from(p.tablaNotas)
        .select(`numero, tipo, monto, anulada, pagada, created_at, ${p.columnaNotas}`)
        .order('created_at', { ascending: false })
        .limit(limiteEfectivo(limite));
      if (!incluirAnuladas) q = q.eq('anulada', false);
      if (ids) q = q.in(p.columnaNotas, ids);
      const { data } = await q;
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      const nombres = await nombresPorId(p.tabla, rows.map(r => String(r[p.columnaNotas] ?? '')).filter(Boolean));
      const filas = rows.map(r => ({
        nota: r.numero != null ? p.codigoNota(String(r.tipo), Number(r.numero)) : null,
        tipo: r.tipo,
        [p.singular]: nombres.get(String(r[p.columnaNotas] ?? '')) ?? null,
        montoUsd: dinero(r.monto),
        fecha: String(r.created_at ?? '').slice(0, 10),
        anulada: Boolean(r.anulada),
        pagada: Boolean(r.pagada),
      }));
      return { filas: filas.length, datos: { fuente: 'notas de ajuste', moneda: MONEDA_FACTURAS, notas: filas } };
    },
  });

  return [buscar, saldo, notas];
}

// ---------------------------------------------------------------------------
// Bancas y movimientos (permiso cochinito)
// ---------------------------------------------------------------------------

export const consultarBancas = definirHerramienta({
  nombre: 'consultar_bancas',
  etiqueta: 'bancas',
  descripcion: 'Saldo actual de cada banca/caja activa (nombre, tipo, moneda, saldo) y total por moneda.',
  parametros: z.object({}),
  permisos: [{ recurso: 'cochinito', accion: 'ver' }],
  async ejecutar() {
    const bancas = await listarBancas();
    const porMoneda = new Map<string, number>();
    for (const b of bancas) porMoneda.set(b.moneda, (porMoneda.get(b.moneda) ?? 0) + Number(b.saldo));
    const filas = bancas.slice(0, 15).map(b => ({
      banca: textoSeguro(b.nombre),
      tipo: b.tipo,
      moneda: b.moneda,
      saldo: dinero(b.saldo),
    }));
    return {
      filas: filas.length,
      datos: {
        fuente: 'bancas',
        bancas: filas,
        totalPorMoneda: [...porMoneda].map(([moneda, total]) => ({ moneda, total: dinero(total) })),
      },
    };
  },
});

const movimientosSchema = z.object({
  tipo: z.enum(['ingreso', 'egreso', 'transferencia']).optional(),
  subtipo: z.enum(['pago', 'adelanto', 'cobro', 'anticipo']).optional().describe('pago/adelanto a proveedores; cobro/anticipo de clientes.'),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  entidad: z.string().max(60).optional().describe('Parte del nombre del proveedor o cliente.'),
  limite: limiteSchema,
});

interface MovimientoFila {
  tipo: string;
  subtipo: string | null;
  monto: number;
  moneda: string;
  monto_usd: number | null;
  fecha: string;
  banca_origen_id: string | null;
  banca_destino_id: string | null;
  proveedor_id: string | null;
  cliente_id: string | null;
}

export const consultarMovimientos = definirHerramienta({
  nombre: 'consultar_movimientos',
  etiqueta: 'movimientos de bancas',
  descripcion:
    'Movimientos recientes del cochinito: ingresos, egresos y transferencias, incluyendo pagos, adelantos y cobros (monto, moneda, banca, proveedor/cliente, fecha).',
  parametros: movimientosSchema,
  permisos: [{ recurso: 'cochinito', accion: 'ver' }],
  async ejecutar({ tipo, subtipo, desde, hasta, entidad, limite }) {
    let filtroEntidad: string | null = null;
    if (entidad) {
      const [provs, clis] = await Promise.all([idsPorNombre('proveedores', entidad), idsPorNombre('clientes', entidad)]);
      const partes = [
        provs.length ? `proveedor_id.in.(${provs.join(',')})` : '',
        clis.length ? `cliente_id.in.(${clis.join(',')})` : '',
      ].filter(Boolean);
      if (partes.length === 0) return { filas: 0, datos: { fuente: 'movimientos', movimientos: [], nota: 'No encontré a nadie con ese nombre.' } };
      filtroEntidad = partes.join(',');
    }
    let q = supabaseAdmin
      .from('movimientos')
      .select('tipo, subtipo, monto, moneda, monto_usd, fecha, banca_origen_id, banca_destino_id, proveedor_id, cliente_id')
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false })
      .limit(limiteEfectivo(limite));
    if (tipo) q = q.eq('tipo', tipo);
    if (subtipo) q = q.eq('subtipo', subtipo);
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    if (filtroEntidad) q = q.or(filtroEntidad);
    const { data } = await q;
    const movs = (data ?? []) as unknown as MovimientoFila[];
    const [bancas, provs, clis] = await Promise.all([
      nombresPorId('bancas', movs.flatMap(m => [m.banca_origen_id, m.banca_destino_id]).filter((x): x is string => !!x)),
      nombresPorId('proveedores', movs.map(m => m.proveedor_id).filter((x): x is string => !!x)),
      nombresPorId('clientes', movs.map(m => m.cliente_id).filter((x): x is string => !!x)),
    ]);
    const filas = movs.map(m => ({
      fecha: String(m.fecha).slice(0, 10),
      tipo: m.tipo,
      subtipo: m.subtipo,
      monto: dinero(m.monto),
      moneda: m.moneda,
      montoUsd: m.monto_usd != null ? dinero(m.monto_usd) : null,
      bancaOrigen: bancas.get(m.banca_origen_id ?? '') ?? null,
      bancaDestino: bancas.get(m.banca_destino_id ?? '') ?? null,
      proveedor: provs.get(m.proveedor_id ?? '') ?? null,
      cliente: clis.get(m.cliente_id ?? '') ?? null,
    }));
    return { filas: filas.length, datos: { fuente: 'movimientos de bancas', movimientos: filas } };
  },
});

export const HERRAMIENTAS_DINERO: readonly HerramientaAsistente[] = [
  consultarFacturas,
  resumenFacturacion,
  ...herramientasDeEntidad(PERFIL_PROVEEDOR),
  ...herramientasDeEntidad(PERFIL_CLIENTE),
  consultarBancas,
  consultarMovimientos,
];
