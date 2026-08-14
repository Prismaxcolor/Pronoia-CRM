import { supabaseAdmin as sb } from '../src/config/supabase.js';
import {
  construirGruposInventario,
  type ProductoInventario,
  type MovimientoInventario,
  type RetiroTransformacion,
} from '../src/services/inventario-service.js';
import {
  construirEstadoCuenta,
  type FacturaCruda,
  type PagoCrudo,
} from '../src/services/estado-cuenta-service.js';

const today = new Date().toISOString().slice(0, 10);
const TAG = '[SMOKETEST]';

let pass = 0;
let fail = 0;
function check(nombre: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${nombre}`); }
  else { fail++; console.log(`  ❌ ${nombre} ${extra}`); }
}

// IDs a limpiar
const ids: Record<string, string | null> = {
  cat: null, prod: null, lista: null, prov: null, cli: null, lote: null,
  banca: null, tCompra: null, tVenta: null, fCompra: null, fVenta: null, mov: null, transf: null,
};

async function ins(tabla: string, row: Record<string, unknown>): Promise<any> {
  const { data, error } = await sb.from(tabla).insert(row).select('*').single();
  if (error) throw new Error(`insert ${tabla}: ${error.message}`);
  return data;
}

async function main() {
  // usuario para campos created_by/registrado_por
  const { data: user } = await sb.from('users').select('id').limit(1).maybeSingle();
  const userId = user?.id ?? null;

  console.log('\n1) Catálogo, lista de precios y entidades');
  const cat = await ins('tipos_material', { nombre: `${TAG} Cobre`, activo: true });
  ids.cat = cat.id;
  const prod = await ins('productos', {
    nombre: `${TAG} Lote 2`, descripcion: '', tipo: 'amarillo', moneda: 'USD',
    activo: true, tipo_material_id: cat.id, peso: 0, creado_por: userId,
  });
  ids.prod = prod.id;
  const lista = await ins('listas_precios', { nombre: `${TAG} Junio`, vigente_desde: today, activo: true });
  ids.lista = lista.id;
  await ins('precios_lista', { lista_id: lista.id, producto_id: prod.id, precio: 15 });
  const prov = await ins('proveedores', { nombre: `${TAG} Proveedor`, activo: true });
  ids.prov = prov.id;
  const cli = await ins('clientes', { nombre: `${TAG} Cliente`, activo: true, creado_por: userId });
  ids.cli = cli.id;
  const lote = await ins('lotes', { nombre: `${TAG} MPP`, activo: true });
  ids.lote = lote.id;
  console.log(`  creados: categoría, producto, lista (precio 15), proveedor, cliente, lote`);

  console.log('\n2) Pesaje (columna generada peso_neto)');
  const tCompra = await ins('tickets_pesaje', {
    tipo: 'compra', entidad_id: prov.id, producto_id: prod.id, fecha: today,
    peso_bruto: 100, tara: 10, devolucion: 5,
  });
  ids.tCompra = tCompra.id;
  check('peso_neto compra = 100-10-5 = 85', Number(tCompra.peso_neto) === 85, `→ ${tCompra.peso_neto}`);
  // detalle real (lo que lee stock_lote_por_producto() y el inventario) — el
  // header de arriba solo prueba las columnas legacy por-material.
  await ins('detalle_tickets_pesaje', {
    ticket_id: tCompra.id, producto_id: prod.id, peso_bruto: 100, tara: 10,
    destino_tipo: 'lote', lote_id: lote.id,
  });

  const tVenta = await ins('tickets_pesaje', {
    tipo: 'venta', entidad_id: cli.id, producto_id: prod.id, fecha: today,
    peso_bruto: 40, tara: 0, devolucion: 0,
  });
  ids.tVenta = tVenta.id;
  check('peso_neto venta = 40', Number(tVenta.peso_neto) === 40, `→ ${tVenta.peso_neto}`);

  console.log('\n3) Facturas (total = peso × precio) y ticket marcado facturado');
  const pesoC = Number(tCompra.peso_neto);
  const fCompra = await ins('facturas_compra', {
    proveedor_id: prov.id, producto_id: prod.id, ticket_id: tCompra.id,
    lista_precios_id: lista.id, precio_unitario: 15, total: pesoC * 15, estado: 'emitida',
  });
  ids.fCompra = fCompra.id;
  await sb.from('tickets_pesaje').update({ facturado: true }).eq('id', tCompra.id);
  check('total compra = 85 × 15 = 1275', Number(fCompra.total) === 1275, `→ ${fCompra.total}`);

  const { data: tChk } = await sb.from('tickets_pesaje').select('facturado').eq('id', tCompra.id).single();
  check('ticket de compra quedó facturado', tChk?.facturado === true);

  const pesoV = Number(tVenta.peso_neto);
  const fVenta = await ins('facturas_venta', {
    cliente_id: cli.id, producto_id: prod.id, ticket_id: tVenta.id,
    precio_unitario: 20, total: pesoV * 20, estado: 'emitida',
  });
  ids.fVenta = fVenta.id;
  check('total venta = 40 × 20 = 800', Number(fVenta.total) === 800, `→ ${fVenta.total}`);

  console.log('\n4) Pago al proveedor (movimiento de tesorería)');
  const banca = await ins('bancas', { nombre: `${TAG} Caja`, saldo: 0, moneda: 'USD', tipo: 'efectivo', archivada: false });
  ids.banca = banca.id;
  const mov = await ins('movimientos', {
    tipo: 'egreso', monto: 500, moneda: 'USD', descripcion: `${TAG} pago`,
    banca_origen_id: banca.id, banca_destino_id: null, fecha: today,
    referencia: '', registrado_por: userId, proveedor_id: prov.id,
  });
  ids.mov = mov.id;
  console.log('  egreso de 500 atribuido al proveedor');

  console.log('\n5) Transformación vía RPC atómica (Bloque 40 — retira 30 del lote, único producto adentro)');
  const pesoLote = 90; // detalle_tickets_pesaje: 100 bruto - 10 tara (sin devolución ahí)
  const { data: transfId, error: rpcErr } = await sb.rpc('crear_transformacion', {
    p_lote_origen_id: lote.id, p_peso_bruto: 30, p_tara: 0, p_fecha: today,
    p_notas: TAG, p_registrado_por: userId,
  });
  if (rpcErr) throw new Error(`rpc: ${rpcErr.message}`);
  ids.transf = transfId as string;
  const { count: detCount } = await sb.from('transformacion_entrada_detalle').select('id', { count: 'exact', head: true }).eq('transformacion_id', transfId);
  check('RPC creó cabecera + 1 detalle de entrada (único producto en el lote)', detCount === 1, `→ ${detCount}`);
  const { data: stockLote } = await sb.rpc('stock_lote_total', { p_lote_id: lote.id });
  check('stock_lote_total tras el retiro = 90 - 30 = 60', Number(stockLote) === 60, `→ ${stockLote}`);

  console.log('\n6) Inventario (función real): 90 compra (en el lote) − 30 retirado = 60; venta (en MPP) = -40');
  const productos: ProductoInventario[] = [{ id: prod.id, nombre: prod.nombre, tipoMaterialId: cat.id, nombreCategoria: 'Cobre' }];
  const compras: MovimientoInventario[] = [
    { productoId: prod.id, destinoTipo: 'lote', loteId: lote.id, destinoLabel: lote.nombre, peso: pesoLote },
  ];
  const ventas: MovimientoInventario[] = [
    { productoId: prod.id, destinoTipo: 'mpp', loteId: null, destinoLabel: 'MPP', peso: pesoV },
  ];
  const retiros: RetiroTransformacion[] = [
    { productoId: prod.id, loteOrigenId: lote.id, nombreLoteOrigen: lote.nombre, peso: 30 },
  ];
  const grupos = construirGruposInventario(productos, compras, ventas, retiros);
  const bucketLote = grupos[0]?.articulos.find(a => a.loteId === lote.id);
  const bucketMpp = grupos[0]?.articulos.find(a => a.destinoTipo === 'mpp');
  check('stock del lote = 90 − 30 = 60', bucketLote?.stock === 60, `→ ${bucketLote?.stock}`);
  check('stock en MPP = -40 (solo la venta, sin compra ahí)', bucketMpp?.stock === -pesoV, `→ ${bucketMpp?.stock}`);

  console.log('\n7) Estado de cuenta del proveedor (función real)');
  const facturasCruda: FacturaCruda[] = [{ id: fCompra.id, total: 1275, descripcion: null, fecha: `${today}T10:00:00Z` }];
  const pagosCrudo: PagoCrudo[] = [{ monto: 500, descripcion: 'pago', referencia: null, fecha: today }];
  const ec = construirEstadoCuenta({ id: prov.id, tipo: 'proveedor', nombre: prov.nombre }, facturasCruda, pagosCrudo);
  check('facturado = 1275', ec.totales.facturado === 1275, `→ ${ec.totales.facturado}`);
  check('pagado = 500', ec.totales.pagado === 500, `→ ${ec.totales.pagado}`);
  check('saldo = 775', ec.totales.saldo === 775, `→ ${ec.totales.saldo}`);
}

async function limpiar() {
  console.log('\n8) Limpieza de datos de prueba');
  const del = async (tabla: string, id: string | null) => { if (id) await sb.from(tabla).delete().eq('id', id); };
  await del('transformaciones', ids.transf); // entrada/salida_detalle caen por cascade
  await del('movimientos', ids.mov);
  await del('facturas_compra', ids.fCompra);
  await del('facturas_venta', ids.fVenta);
  await del('tickets_pesaje', ids.tCompra); // detalle_tickets_pesaje cae por cascade
  await del('tickets_pesaje', ids.tVenta);
  if (ids.lista) await sb.from('precios_lista').delete().eq('lista_id', ids.lista);
  await del('listas_precios', ids.lista);
  await del('bancas', ids.banca);
  await del('lotes', ids.lote);
  await del('productos', ids.prod);
  await del('tipos_material', ids.cat);
  await del('proveedores', ids.prov);
  await del('clientes', ids.cli);
  console.log('  limpieza completa');
}

try {
  await main();
} catch (e) {
  fail++;
  console.log(`\n❌ ERROR: ${e instanceof Error ? e.message : e}`);
} finally {
  await limpiar();
}

console.log(`\n=== ${pass} OK · ${fail} fallos ===`);
process.exit(fail === 0 ? 0 : 1);
