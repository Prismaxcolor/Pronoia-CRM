import type { Request, Response, NextFunction } from 'express';
import { invalidarCacheSaldos } from '../services/saldos-service.js';

const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Middleware global: al terminar cualquier petición que escribe (facturas, pagos, cobros, notas, cruces,
 * tickets...) vacía la caché de saldos. Sobrecubre a propósito (también un POST fallido a medias) porque
 * recalcular cuesta poco y así ningún flujo de escritura nuevo deja saldos viejos. Nunca altera la respuesta.
 */
export function invalidarSaldosMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (METODOS_MUTANTES.has(req.method)) {
    res.on('finish', () => {
      try {
        invalidarCacheSaldos();
      } catch {
        // la caché tiene TTL propio: un fallo aquí no debe afectar a la petición
      }
    });
  }
  next();
}
