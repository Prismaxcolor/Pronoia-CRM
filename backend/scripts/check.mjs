import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.log('❌ Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en backend/.env');
  process.exit(1);
}
const sb = createClient(url, key);

const checks = [
  ['tipos_material', 'id, nombre, activo'],
  ['proveedores', 'id, nombre, rfc'],
  ['clientes', 'id, nombre'],
  ['productos', 'id, tipo_material_id'],
  ['listas_precios', 'id, nombre, vigente_desde, activo'],
  ['precios_lista', 'id, lista_id, producto_id, precio'],
  ['tickets_pesaje', 'id, producto_id, peso_neto'],
  ['facturas_compra', 'id, producto_id, proveedor_id, total'],
  ['facturas_venta', 'id, producto_id, cliente_id, total'],
  ['movimientos', 'id, proveedor_id, cliente_id'],
  ['transformaciones', 'id, material_entrada_id'],
  ['detalle_transformaciones', 'id, material_salida_id'],
];

let ok = true;
for (const [tabla, cols] of checks) {
  const { error } = await sb.from(tabla).select(cols).limit(1);
  if (error) { ok = false; console.log(`❌ ${tabla} (${cols}) → ${error.message}`); }
  else console.log(`✅ ${tabla}`);
}

// ¿Existe la RPC de transformación? (uuid inexistente → FK violation = existe; "does not exist" = falta)
const { error: rpcErr } = await sb.rpc('crear_transformacion', {
  p_material_entrada_id: '00000000-0000-4000-8000-000000000000',
  p_cantidad_entrada: 0, p_notas: null, p_fecha: null, p_detalles: [],
});
if (rpcErr && /does not exist|could not find/i.test(rpcErr.message)) { ok = false; console.log(`❌ RPC crear_transformacion → ${rpcErr.message}`); }
else console.log('✅ RPC crear_transformacion existe');

// ¿Bucket de Storage 'tickets'?
const { data: buckets } = await sb.storage.listBuckets();
const tieneTickets = (buckets ?? []).some(b => b.name === 'tickets');
console.log(tieneTickets ? "✅ bucket 'tickets'" : "⚠️  bucket 'tickets' no existe (fotos del pesaje fallarían)");

console.log(ok ? '\n=== ESQUEMA OK ===' : '\n=== FALTAN MIGRACIONES ===');
process.exit(ok ? 0 : 2);
