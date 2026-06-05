import { Router } from 'express';
import { obtenerInventario } from '../services/inventario-service.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', requirePermiso('productos', 'ver'), async (req, res) => {
  const grupos = await obtenerInventario({
    tipoMaterialId: req.query.tipoMaterialId ? String(req.query.tipoMaterialId) : undefined,
    productoId: req.query.productoId ? String(req.query.productoId) : undefined,
    desde: req.query.desde ? String(req.query.desde) : undefined,
    hasta: req.query.hasta ? String(req.query.hasta) : undefined,
  });
  res.json({ grupos });
});

export default router;
