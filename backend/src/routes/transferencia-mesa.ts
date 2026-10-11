import { Router, type Response } from 'express';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { validateBody } from '../middlewares/validate.js';
import { validarUuidParam } from '../middlewares/validate-uuid-param.js';
import { exigirAccesoBancas } from '../middlewares/exigir-acceso-bancas.js';
import { crearTransferenciaMesaSchema } from '../schemas/transferencia-mesa.js';
import { completarTransferenciaMesa, crearTransferenciaMesa } from '../services/transferencia-mesa-service.js';
import { idsBancasDeMovimiento } from '../services/banca-acceso-service.js';
import { logger, clienteIp } from '../utils/logger.js';
import { cuerpoConRepetida, ejecutarOperacion, TIPO_OPERACION } from '../services/operaciones-idempotentes-cola.js';

/**
 * Transferencias de Wallet con mesa de cambio. Se monta en /api/cochinito junto al router de Wallet.
 * Crear exige poder crear en Wallet Y en la mesa de cambio; completar, editar en Wallet y ver la mesa.
 * Anular usa la ruta de siempre (POST /movimientos/:id/anular), que elige la RPC según el movimiento y, si hay
 * cambista, exige además mesa_cambio:ver (el mismo permiso que completar: ver la mesa basta para operar sus
 * transferencias; crear sí exige mesa_cambio:crear).
 */
const router = Router();

router.use(requireAuth);

function responderFallo(res: Response, f: { error: string; codigo: number }): void {
  res.status(f.codigo).json({ error: f.error });
}

router.post(
  '/movimientos/mesa-cambio',
  requirePermiso('cochinito', 'crear'),
  requirePermiso('mesa_cambio', 'crear'),
  validateBody(crearTransferenciaMesaSchema),
  exigirAccesoBancas(),
  async (req, res) => {
    // Con clientRequestId un doble clic o reintento no crea una segunda transferencia (responde 200 con `repetida`).
    const envio = await ejecutarOperacion(res, TIPO_OPERACION.walletMesaCambioCrear, req.body, req.user!.sub,
      () => crearTransferenciaMesa(req.body, req.user!.sub));
    if (!envio) return;
    const { resultado: r, repetida } = envio;
    if ('error' in r) return responderFallo(res, r);
    logger.info({
      evento: 'transferencia_mesa_creada', ip: clienteIp(req), userId: req.user!.sub,
      movimientoId: r.transferencia.movimiento.id, cambistaId: req.body.cambistaId, repetida,
    });
    res.status(repetida ? 200 : 201).json(cuerpoConRepetida(r, repetida));
  },
);

router.post(
  '/movimientos/:id/completar',
  validarUuidParam('id'),
  requirePermiso('cochinito', 'editar'),
  requirePermiso('mesa_cambio', 'ver'),
  exigirAccesoBancas(req => idsBancasDeMovimiento(String(req.params.id))),
  async (req, res) => {
    const id = String(req.params.id);
    const r = await completarTransferenciaMesa(id, req.user!.sub);
    if ('error' in r) return responderFallo(res, r);
    logger.info({
      evento: 'transferencia_mesa_completada', ip: clienteIp(req), userId: req.user!.sub, movimientoId: id, yaCompletada: r.yaCompletada,
    });
    res.json(r);
  },
);

export default router;
