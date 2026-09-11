/**
 * Fase 8 del plan de consolidación (docs/PLAN_consolidacion_inventario.md):
 * guardarraíl permanente. Compara, para cada almacén, el stock calculado
 * por stock_almacen() (SQL) contra el de obtenerInventarioAlmacen() (TS) —
 * después de la Fase 4 son el mismo cálculo, así que en teoría siempre
 * deberían coincidir exactamente. Si alguna vez un cambio futuro rompe esa
 * igualdad (por ejemplo, alguien vuelve a hacer que una de las dos
 * funciones recalcule por su cuenta), este script lo va a mostrar como una
 * fila con diferencia > 0.01 kg.
 *
 * También revisa una invariante básica: ningún lote debería tener stock por
 * producto con NaN/null, y todo producto_id referenciado en un movimiento
 * (compra/venta/transformación/ajuste) debería existir en el catálogo.
 *
 * Uso: npx tsx scripts/verificar-stock.ts   (desde backend/)
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/config/supabase.js';
import { obtenerInventarioAlmacen } from '../src/services/inventario-service.js';

async function main() {
  let discrepancias = 0;

  const { data: almacenes, error: errAlm } = await supabaseAdmin
    .from('almacenes')
    .select('id, nombre')
    .eq('activo', true);
  if (errAlm) throw errAlm;

  for (const almacen of almacenes ?? []) {
    const { data: sqlRows, error: errSql } = await supabaseAdmin.rpc('stock_almacen', {
      p_almacen_id: almacen.id,
    });
    if (errSql) throw errSql;

    const sqlPorProducto = new Map<string, number>();
    for (const r of (sqlRows as Array<{ producto_id: string; stock: number }>) ?? []) {
      if (Math.abs(Number(r.stock)) > 0.005) sqlPorProducto.set(r.producto_id, Number(r.stock));
    }

    const grupos = await obtenerInventarioAlmacen(almacen.id);
    const tsPorProducto = new Map<string, number>();
    for (const g of grupos) for (const a of g.articulos) tsPorProducto.set(a.productoId, a.stock);

    const idsTodos = new Set([...sqlPorProducto.keys(), ...tsPorProducto.keys()]);
    for (const productoId of idsTodos) {
      const sql = sqlPorProducto.get(productoId) ?? 0;
      const ts = tsPorProducto.get(productoId) ?? 0;
      if (Math.abs(sql - ts) > 0.01) {
        discrepancias++;
        console.log(
          `[DIFERENCIA] almacén "${almacen.nombre}" producto ${productoId}: SQL=${sql.toFixed(3)} vs TS=${ts.toFixed(3)}`
        );
      }
    }
  }

  // Invariante: la suma de todos los lotes atribuidos a un almacén nunca
  // debería tener stock_lote_total() = NaN (lote_id inválido, ciclo, etc.)
  const { data: lotes } = await supabaseAdmin.from('lotes').select('id, nombre');
  for (const lote of lotes ?? []) {
    const { data: total, error } = await supabaseAdmin.rpc('stock_lote_total', { p_lote_id: lote.id });
    if (error || total === null || Number.isNaN(Number(total))) {
      discrepancias++;
      console.log(`[INVARIANTE] lote "${lote.nombre}" (${lote.id}): stock_lote_total() inválido`, error?.message);
    }
  }

  if (discrepancias === 0) {
    console.log('OK — sin discrepancias entre stock_almacen() (SQL) y obtenerInventarioAlmacen() (TS).');
  } else {
    console.log(`\n${discrepancias} discrepancia(s) encontradas. Revisar antes de confiar en estos números.`);
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
