import { Router } from 'express';
import { obtenerInventario, obtenerInventarioAlmacen } from '../services/inventario-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { parsearAlmacenId } from '../schemas/inventario.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('productos', 'ver'), async (req, res) => {
  const tipoMaterialId = req.query.tipoMaterialId ? String(req.query.tipoMaterialId) : undefined;
  const productoId = req.query.productoId ? String(req.query.productoId) : undefined;
  const almacen = parsearAlmacenId(req.query.almacenId);
  if (!almacen.ok) {
    res.status(400).json({ error: almacen.error });
    return;
  }
  const almacenId = almacen.almacenId;

  const desde = req.query.desde ? String(req.query.desde) : undefined;
  const hasta = req.query.hasta ? String(req.query.hasta) : undefined;

  // Filtrado por almacén: obtenerInventarioAlmacen() reconstruye los
  // movimientos del almacén (compras, ventas, traslados, transformaciones,
  // ajustes) con las mismas reglas de atribución que stock_almacen() en SQL
  // y soporta un lote repartido entre varios almacenes. desde/hasta acotan
  // los movimientos igual que en la vista global.
  const grupos = almacenId
    ? await obtenerInventarioAlmacen(almacenId, { tipoMaterialId, productoId, desde, hasta })
    : await obtenerInventario({ tipoMaterialId, productoId, desde, hasta });
  res.json({ grupos });
});

export default router;
