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
import { bancasPermitidasDeUsuario } from '../services/banca-acceso-service.js';
import { cuentaVisible, filtrarBancas, filtrarMovimientos, TEXTO_CUENTA_RESTRINGIDA, type BancasPermitidas } from './banca-acceso.js';
import {
  definirHerramienta,
  fechaSchema,
  limiteEfectivo,
  limiteSchema,
  patronBusqueda,
  redondear,
  textoSeguro,
  type HerramientaAsistente,
  type ResultadoHerramienta,
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
import { formatearMonto } from './asistente-formato.js';
import { coincidePorPalabras, sugerirParecidos } from './asistente-similitud.js';
import { derivarEstadoFactura, saldoFactura, type EstadoFacturaGuardado } from './estado-factura.js';
import { diaNegocio, inicioDiaNegocio, finDiaNegocio } from './fecha-negocio.js';

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

const pendiente = (f: FacturaFila): number => saldoFactura({ total: Number(f.total), montoPagado: Number(f.monto_pagado ?? 0) });

/** Estado según los pagos (emitida | pendiente | pagada), mismo criterio que las pantallas. */
const estadoDe = (f: FacturaFila) =>
  derivarEstadoFactura({ estado: f.estado as EstadoFacturaGuardado, total: Number(f.total), montoPagado: Number(f.monto_pagado ?? 0) });

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

/** Cuántos proveedores/clientes se muestran en el desglose de lo pendiente. */
const MAX_ENTIDADES_PENDIENTE = 8;

/** Total pendiente y desglose por proveedor/cliente de las facturas con saldo. */
function resumenPendientes(facturas: FacturaFila[], col: 'proveedor_id' | 'cliente_id', nombres: Map<string, string>, tipo: TipoFactura) {
  const porEntidad = new Map<string, number>();
  for (const f of facturas) {
    const nombre = nombres.get(String(f[col] ?? '')) ?? 'Sin nombre';
    porEntidad.set(nombre, (porEntidad.get(nombre) ?? 0) + pendiente(f));
  }
  const total = sumar(facturas.map(pendiente));
  return {
    facturasConSaldo: facturas.length,
    totalPendienteUsd: dinero(total),
    totalPendienteTexto: formatearMonto(total),
    [tipo === 'compra' ? 'pendientePorProveedor' : 'pendientePorCliente']: [...porEntidad]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_ENTIDADES_PENDIENTE)
      .map(([nombre, monto]) => ({ nombre, pendienteUsd: dinero(monto), pendienteTexto: formatearMonto(monto) })),
  };
}

const facturasSchema = z.object({
  tipo: z.enum(['compra', 'venta']).describe('compra = facturas de compra a PROVEEDORES (lo que debemos pagar); venta = facturas de venta a CLIENTES (lo que nos deben cobrar).'),
  estado: z.enum(['emitida', 'pendiente', 'pagada']).optional().describe("'emitida' = sin ningún pago; 'pendiente' = con algún pago y saldo por pagar; 'pagada' = sin saldo."),
  soloPendientes: z.boolean().optional().describe('true = solo facturas con saldo pendiente (> 0), con el total pendiente y el desglose por proveedor/cliente. Úsalo para "facturas pendientes de pago/cobro" y "a quién le debemos/quién nos debe".'),
  desde: fechaSchema.optional(),
  hasta: fechaSchema.optional(),
  entidad: z.string().max(60).optional().describe('Parte del nombre del proveedor/cliente.'),
  limite: limiteSchema,
});

export const consultarFacturas = definirHerramienta({
  nombre: 'consultar_facturas',
  etiqueta: 'facturas',
  descripcion: `Facturas de compra (a proveedores) o de venta (a clientes) recientes: total, pagado y pendiente en ${MONEDA_FACTURAS}. Úsala para "facturas pendientes de pago" (tipo compra + soloPendientes), "facturas pendientes de cobro" (tipo venta + soloPendientes), "facturas de [proveedor/cliente]". Para el saldo total de UNA persona usa saldo_proveedor o saldo_cliente.`,
  parametros: facturasSchema,
  permisos: [{ recurso: 'facturacion', accion: 'ver' }],
  async ejecutar({ tipo, estado, soloPendientes, desde, hasta, entidad, limite }) {
    let ids: string[] | null = null;
    if (entidad) {
      ids = await idsPorNombre(TABLA_ENTIDAD[tipo], entidad);
      if (ids.length === 0) return { filas: 0, datos: { fuente: 'facturación', facturas: [], nota: `No encontré ningún ${TABLA_ENTIDAD[tipo] === 'proveedores' ? 'proveedor' : 'cliente'} con ese nombre (revisa si es del otro tipo).` } };
    }
    const col = COLUMNA_ENTIDAD[tipo];
    let q = supabaseAdmin
      .from(TABLA_FACTURAS[tipo])
      .select(`numero, total, monto_pagado, estado, created_at, ${col}`)
      .in('estado', soloPendientes ? ['emitida'] : ESTADOS_FACTURA_VIGENTE)
      .order('created_at', { ascending: false })
      .limit(soloPendientes ? MAX_FACTURAS_RESUMEN : limiteEfectivo(limite));
    if (desde) q = q.gte('created_at', inicioDiaNegocio(desde));
    if (hasta) q = q.lte('created_at', finDiaNegocio(hasta));
    if (ids) q = q.in(col, ids);
    const { data } = await q;
    const leidas = ((data ?? []) as unknown as FacturaFila[]).filter(f => !estado || estadoDe(f) === estado);
    const conSaldo = soloPendientes ? leidas.filter(f => pendiente(f) > 0.005) : leidas;
    const facturas = conSaldo.slice(0, limiteEfectivo(limite));
    const nombres = await nombresPorId(TABLA_ENTIDAD[tipo], conSaldo.map(f => String(f[col] ?? '')).filter(Boolean));
    const formato = tipo === 'compra' ? formatCodigoCompra : formatCodigoVenta;
    const filas = facturas.map(f => ({
      factura: f.numero != null ? formato(f.numero) : null,
      fecha: diaNegocio(f.created_at) ?? f.created_at.slice(0, 10),
      [tipo === 'compra' ? 'proveedor' : 'cliente']: nombres.get(String(f[col] ?? '')) ?? null,
      estado: estadoDe(f),
      totalUsd: dinero(f.total),
      pagadoUsd: dinero(f.monto_pagado),
      pendienteUsd: dinero(pendiente(f)),
      pendienteTexto: formatearMonto(pendiente(f)),
    }));
    return {
      filas: filas.length,
      datos: {
        fuente: 'facturación',
        moneda: MONEDA_FACTURAS,
        facturas: filas,
        ...(soloPendientes ? resumenPendientes(conSaldo, col, nombres, tipo) : {}),
      },
    };
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
      .gte('created_at', inicioDiaNegocio(desde))
      .lte('created_at', finDiaNegocio(hasta))
      .limit(MAX_FACTURAS_RESUMEN),
    supabaseAdmin.from(tabla).select('total, monto_pagado').eq('estado', 'emitida').limit(MAX_FACTURAS_RESUMEN),
  ]);
  const del = (periodo.data ?? []) as unknown as FacturaFila[];
  const pend = (abiertas.data ?? []) as unknown as FacturaFila[];
  return {
    periodo: { facturas: del.length, totalUsd: dinero(sumar(del.map(f => f.total))), totalTexto: formatearMonto(sumar(del.map(f => f.total))) },
    pendientesDePagoEnGeneral: {
      facturas: pend.length,
      montoPendienteUsd: dinero(sumar(pend.map(pendiente))),
      montoPendienteTexto: formatearMonto(sumar(pend.map(pendiente))),
    },
  };
}

export const resumenFacturacion = definirHerramienta({
  nombre: 'resumen_facturacion',
  etiqueta: 'resumen de facturación',
  descripcion: `Total facturado en compras (a proveedores) y ventas (a clientes) del período (por defecto hoy, en ${MONEDA_FACTURAS}) y el monto pendiente de pago/cobro en general. Úsala para "cuánto facturamos hoy/este mes" y "cuánto tenemos pendiente". Para el detalle por factura o por proveedor/cliente usa consultar_facturas con soloPendientes.`,
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

export interface Perfil {
  tipo: TipoEntidad;
  tabla: 'proveedores' | 'clientes';
  singular: 'proveedor' | 'cliente';
  plural: 'proveedores' | 'clientes';
  tablaNotas: 'notas_ajuste_proveedor' | 'notas_ajuste_cliente';
  columnaNotas: 'proveedor_id' | 'cliente_id';
  permiso: Permiso;
  /** Pista para el modelo cuando el nombre no existe en esta lista. */
  ayudaNoEncontrado: string;
  codigoNota: (tipo: string, numero: number) => string;
}

export const PERFIL_PROVEEDOR: Perfil = {
  tipo: 'proveedor',
  tabla: 'proveedores',
  singular: 'proveedor',
  plural: 'proveedores',
  tablaNotas: 'notas_ajuste_proveedor',
  columnaNotas: 'proveedor_id',
  permiso: { recurso: 'proveedores', accion: 'ver' },
  ayudaNoEncontrado: 'No hay ningún proveedor con ese nombre. Si no sabes si la persona es proveedor o cliente, usa saldo_persona o buscar_persona (buscan en ambos lados y reportan solo donde existe). No le digas al usuario que "no existe como proveedor".',
  codigoNota: (t, n) => (t === 'credito' ? formatCodigoNotaCredito(n) : formatCodigoNotaDebito(n)),
};
export const PERFIL_CLIENTE: Perfil = {
  tipo: 'cliente',
  tabla: 'clientes',
  singular: 'cliente',
  plural: 'clientes',
  tablaNotas: 'notas_ajuste_cliente',
  columnaNotas: 'cliente_id',
  permiso: { recurso: 'clientes', accion: 'ver' },
  ayudaNoEncontrado: 'No hay ningún cliente con ese nombre. Si no sabes si la persona es proveedor o cliente, usa saldo_persona o buscar_persona (buscan en ambos lados y reportan solo donde existe). No le digas al usuario que "no existe como cliente".',
  codigoNota: (t, n) => (t === 'credito' ? formatCodigoNotaCreditoCliente(n) : formatCodigoNotaDebitoCliente(n)),
};

/** Resuelve un nombre a UNA entidad; si es ambiguo o no existe, devuelve las opciones. */
export async function resolverEntidad(p: Perfil, nombre: string) {
  const { data } = await supabaseAdmin
    .from(p.tabla)
    .select('id, nombre')
    .ilike('nombre', patronBusqueda(nombre))
    .limit(6);
  let filas = (data ?? []) as Array<{ id: string; nombre: string }>;
  if (filas.length === 0) filas = (await filtrarPorPalabras(p, nombre)).slice(0, 6);
  const exacta = filas.filter(f => f.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
  const elegida = filas.length === 1 ? filas[0] : exacta.length === 1 ? exacta[0] : undefined;
  return { elegida, opciones: filas.map(f => textoSeguro(f.nombre)) };
}

/** Tope de nombres que se leen para la búsqueda por palabras / sugerencias (catálogos pequeños). */
const MAX_NOMBRES_BUSQUEDA = 300;
const MAX_SUGERENCIAS_NOMBRE = 8;

export async function todosLosNombres(p: Perfil): Promise<Array<{ id: string; nombre: string; activo?: boolean }>> {
  const { data } = await supabaseAdmin.from(p.tabla).select('id, nombre, activo').order('nombre').limit(MAX_NOMBRES_BUSQUEDA);
  return ((data ?? []) as Array<{ id: string; nombre: string; activo?: boolean }>).filter(f => typeof f.nombre === 'string');
}

/** Coincidencia por palabras sueltas, sin importar el orden ni los acentos ("teques jesus"). */
async function filtrarPorPalabras(p: Perfil, nombre: string) {
  return (await todosLosNombres(p)).filter(f => coincidePorPalabras(f.nombre, nombre));
}

/** Nombres parecidos (o, si no hay, unos cuantos existentes) para ofrecer cuando no se encuentra a nadie. */
export async function sugerenciasDeNombre(p: Perfil, nombre: string): Promise<{ parecidos: string[]; ejemplos: string[] }> {
  const nombres = (await todosLosNombres(p)).map(f => textoSeguro(f.nombre));
  return { parecidos: sugerirParecidos(nombre, nombres, 5), ejemplos: nombres.slice(0, MAX_SUGERENCIAS_NOMBRE) };
}

/** Frase lista para el modelo: qué significa el signo del saldo (evita confundir deuda con saldo a favor). */
export function lecturaSaldo(tipo: TipoEntidad, saldo: number): string {
  const monto = formatearMonto(Math.abs(saldo));
  if (Math.abs(saldo) < 0.005) return 'Saldo en cero: no hay deuda pendiente.';
  if (tipo === 'proveedor') return saldo > 0 ? `Le debemos ${monto} al proveedor.` : `No le debemos nada: hemos pagado ${monto} de más (saldo a nuestro favor).`;
  return saldo > 0 ? `El cliente nos debe ${monto}.` : `El cliente no nos debe nada: tiene ${monto} a su favor.`;
}

const CODIGO_CORRELATIVO = /^(?:PG|AD|NC|ND|CB|AC|NCV|NDV|CR|CRV|TR|C|V)-\d{4,9}$/;

/** Devuelve la referencia solo si es un código correlativo válido (PG-0001, NC-0003...); si no, null. */
export function codigoCorrelativo(valor: unknown): string | null {
  return typeof valor === 'string' && CODIGO_CORRELATIVO.test(valor) ? valor : null;
}

/** Estado de cuenta (en USD) de UNA entidad ya resuelta: totales, lectura del saldo y últimos movimientos. */
export async function estadoDeCuentaDe(p: Perfil, id: string): Promise<ResultadoHerramienta> {
  const estado = await obtenerEstadoCuenta(p.tipo, id);
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
      saldoTexto: formatearMonto(estado.totales.saldo),
      lectura: lecturaSaldo(p.tipo, Number(estado.totales.saldo)),
      ultimosMovimientos: recientes,
    },
  };
}

function herramientasDeEntidad(p: Perfil): HerramientaAsistente[] {
  const buscar = definirHerramienta({
    nombre: `buscar_${p.singular}`,
    etiqueta: p.plural,
    descripcion:
      p.tipo === 'proveedor'
        ? 'Busca PROVEEDORES (a quienes les compramos material y a quienes les debemos) por nombre aproximado: solo nombre y si está activo. Úsala para confirmar cómo se escribe un nombre o, si no sabes si es proveedor o cliente, usa mejor buscar_persona. Sin datos de contacto.'
        : 'Busca CLIENTES (a quienes les vendemos material y que nos deben a nosotros) por nombre aproximado: solo nombre y si está activo. Úsala para confirmar cómo se escribe un nombre o, si no sabes si es cliente o proveedor, usa mejor buscar_persona. Sin datos de contacto.',
    parametros: buscarSchema,
    permisos: [p.permiso],
    async ejecutar({ nombre, limite }) {
      const { data } = await supabaseAdmin
        .from(p.tabla)
        .select('nombre, activo')
        .ilike('nombre', patronBusqueda(nombre))
        .order('nombre')
        .limit(limiteEfectivo(limite));
      let encontrados = (data ?? []) as Array<{ nombre: string; activo: boolean }>;
      if (encontrados.length === 0) {
        const todos = await todosLosNombres(p);
        const porPalabras = todos.filter(f => coincidePorPalabras(f.nombre, nombre)).slice(0, limiteEfectivo(limite));
        encontrados = porPalabras.map(f => ({ nombre: f.nombre, activo: f.activo !== false }));
      }
      const filas = encontrados.map(r => ({ nombre: textoSeguro(r.nombre), activo: Boolean(r.activo) }));
      return {
        filas: filas.length,
        datos: {
          fuente: p.plural,
          [p.plural]: filas,
          ...(filas.length === 0 ? { ...(await sugerenciasDeNombre(p, nombre)), ayuda: p.ayudaNoEncontrado } : {}),
        },
      };
    },
  });

  const saldo = definirHerramienta({
    nombre: `saldo_${p.singular}`,
    etiqueta: `estado de cuenta de ${p.singular}`,
    descripcion:
      p.tipo === 'proveedor'
        ? `Estado de cuenta de un PROVEEDOR en ${MONEDA_FACTURAS}: facturado, pagado, saldo y últimos movimientos. Úsala cuando pregunten "cuánto le debemos a X", "cuánto le hemos pagado/comprado a X", "saldo de X" y X sea alguien a quien le compramos. saldoUsd positivo = le debemos; negativo = tiene saldo a nuestro favor (le pagamos de más/adelantos). Si no sabes si X es proveedor o cliente, usa saldo_persona.`
        : `Estado de cuenta de un CLIENTE en ${MONEDA_FACTURAS}: facturado, cobrado, saldo y últimos movimientos. Úsala cuando pregunten "cuánto nos debe X", "cuánto le hemos vendido/cobrado a X" y X sea alguien a quien le vendemos. saldoUsd positivo = nos debe; negativo = tiene saldo a su favor. Si no sabes si X es cliente o proveedor, usa saldo_persona.`,
    parametros: saldoSchema,
    permisos: [p.permiso],
    async ejecutar({ nombre }) {
      const { elegida, opciones } = await resolverEntidad(p, nombre);
      if (!elegida) {
        const sinNadie = opciones.length === 0;
        return {
          filas: 0,
          datos: {
            fuente: `estado de cuenta (${p.singular})`,
            error: sinNadie ? `No encontré ningún ${p.singular} con ese nombre.` : `Hay varios ${p.plural} con ese nombre; pregunta cuál.`,
            posibles: opciones,
            ...(sinNadie ? { ...(await sugerenciasDeNombre(p, nombre)), ayuda: p.ayudaNoEncontrado } : {}),
          },
        };
      }
      return estadoDeCuentaDe(p, elegida.id);
    },
  });

  const notas = definirHerramienta({
    nombre: `consultar_notas_${p.singular}`,
    etiqueta: `notas de crédito/débito de ${p.plural}`,
    descripcion: `Notas de crédito y débito (ajustes a la cuenta) vigentes de ${p.plural.toUpperCase()}: número, tipo, monto en ${MONEDA_FACTURAS}, fecha y si ya se pagó. Sin el motivo. Úsala para "notas de crédito/débito de X" o "qué ajustes tiene X".`,
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
        fecha: diaNegocio(String(r.created_at ?? '')) ?? String(r.created_at ?? '').slice(0, 10),
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
  descripcion: 'Saldo actual de cada banca/caja/cochinito activa (nombre, tipo, moneda, saldo) y el total por moneda. Úsala para "cuánto dinero/efectivo hay", "saldo de las bancas/cajas". Un saldo negativo es real (la caja está en sobregiro); repórtalo tal cual.',
  parametros: z.object({}),
  permisos: [{ recurso: 'cochinito', accion: 'ver' }],
  async ejecutar(_args, ctx) {
    const bancas = filtrarBancas(await listarBancas(), await bancasPermitidasDeUsuario(ctx.userId));
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
        totalPorMoneda: [...porMoneda].map(([moneda, total]) => ({ moneda, total: dinero(total), texto: formatearMonto(total, moneda) })),
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

/** Filtro PostgREST: movimientos cuyo origen o destino está entre las bancas permitidas. */
export function filtroBancas(permitidas: ReadonlySet<string>): string {
  const lista = [...permitidas].join(',');
  return `banca_origen_id.in.(${lista}),banca_destino_id.in.(${lista})`;
}

/** Nombre de la cuenta, o 'Cuenta restringida' si es la otra punta de una transferencia a la que no se tiene acceso. */
function nombreBancaVisible(nombres: ReadonlyMap<string, string>, permitidas: BancasPermitidas, id: string | null): string | null {
  if (!id) return null;
  return cuentaVisible(permitidas, id) ? (nombres.get(id) ?? null) : TEXTO_CUENTA_RESTRINGIDA;
}

export const consultarMovimientos = definirHerramienta({
  nombre: 'consultar_movimientos',
  etiqueta: 'movimientos de bancas',
  descripcion:
    'Movimientos recientes de dinero de las bancas/cochinito, del más nuevo al más viejo: ingresos, egresos y transferencias (monto, moneda, banca, proveedor/cliente, fecha). Úsala para "qué pagos hicimos" (subtipo pago/adelanto = salidas a proveedores), "qué cobros recibimos" (subtipo cobro/anticipo = entradas de clientes), "últimos movimientos". Para "esta semana" pasa desde/hasta con las fechas de la sección de fechas.',
  parametros: movimientosSchema,
  permisos: [{ recurso: 'cochinito', accion: 'ver' }],
  async ejecutar({ tipo, subtipo, desde, hasta, entidad, limite }, ctx) {
    const permitidas = await bancasPermitidasDeUsuario(ctx.userId);
    // Sin ninguna cuenta no hay nada que consultar (y un in.() vacío no es válido en PostgREST).
    if (permitidas !== null && permitidas.size === 0) return { filas: 0, datos: { fuente: 'movimientos de bancas', movimientos: [] } };
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
      .limit(limiteEfectivo(limite))
      .eq('anulado', false);
    if (tipo) q = q.eq('tipo', tipo);
    if (subtipo) q = q.eq('subtipo', subtipo);
    if (desde) q = q.gte('fecha', desde);
    if (hasta) q = q.lte('fecha', hasta);
    if (filtroEntidad) q = q.or(filtroEntidad);
    // El filtro por cuenta va en la consulta, ANTES del límite: filtrar después dejaría pocas filas visibles.
    if (permitidas !== null) q = q.or(filtroBancas(permitidas));
    const { data } = await q;
    const movs = filtrarMovimientos(
      ((data ?? []) as unknown as MovimientoFila[]).map(m => ({ ...m, bancaOrigenId: m.banca_origen_id ?? '', bancaDestinoId: m.banca_destino_id })),
      permitidas
    );
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
      bancaOrigen: nombreBancaVisible(bancas, permitidas, m.banca_origen_id),
      bancaDestino: nombreBancaVisible(bancas, permitidas, m.banca_destino_id),
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
