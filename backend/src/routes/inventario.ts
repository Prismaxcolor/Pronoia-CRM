import { Router } from 'express';
import { obtenerInventario, obtenerInventarioAlmacen } from '../services/inventario-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('productos', 'ver'), async (req, res) => {
  const tipoMaterialId = req.query.tipoMaterialId ? String(req.query.tipoMaterialId) : undefined;
  const productoId = req.query.productoId ? String(req.query.productoId) : undefined;
  const almacenId = req.query.almacenId ? String(req.query.almacenId) : undefined;

  // Filtrado por almacén: usa stock_almacen() (SQL, ya escopado por lote+
  // almacén — ver docs/migration_lote_composicion_por_almacen.sql) en vez de
  // obtenerInventario(), que reconstruye todo en JS a mano y no soporta un
  // lote repartido entre varios almacenes. Nota: al filtrar por almacén no
  // se pueden aplicar desde/hasta (stock_almacen() es una foto del momento,
  // no un histórico) — mismo límite que ya tenía antes de este fix.
  const grupos = almacenId
    ? await obtenerInventarioAlmacen(almacenId, { tipoMaterialId, productoId })
    : await obtenerInventario({
        tipoMaterialId,
        productoId,
        desde: req.query.desde ? String(req.query.desde) : undefined,
        hasta: req.query.hasta ? String(req.query.hasta) : undefined,
      });
  res.json({ grupos });
});

export default router;
