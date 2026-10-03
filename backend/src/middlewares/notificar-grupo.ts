import type { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { buscarEvento, debeNotificar, type Metodo } from '../services/grupo-eventos.js';
import {
  notificarGrupo, construirPayloadGrupo, etiquetaPreviaParaBorrado, type PeticionEvento,
} from '../services/grupo-notificar-service.js';

const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Middleware global (se monta UNA vez en app.ts, antes de los routers). Cuando una ruta
 * mutante catalogada termina con 2xx, arma y manda el aviso al grupo de Telegram.
 *
 * - Nunca altera la respuesta: solo observa res.json() y actúa en el evento 'finish',
 *   cuando el cliente ya recibió su respuesta (no la retrasa).
 * - Todo error queda logueado; jamás se propaga.
 * - req.user lo pone requireAuth de cada router; se lee recién en 'finish'.
 */
export function notificarGrupoMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    if (!ENV.GRUPO_NOTIFICACIONES_ACTIVAS || !METODOS_MUTANTES.has(req.method)) {
      next();
      return;
    }
    const ruta = req.originalUrl.split('?')[0];
    const encontrado = buscarEvento(req.method, ruta);
    const filtro = { silenciados: ENV.GRUPO_EVENTOS_SILENCIADOS, incluirRuidosos: ENV.GRUPO_INCLUIR_RUIDOSOS };
    if (!encontrado || (encontrado.evento.importancia === 'ignorable') ||
        (!encontrado.evento.variante && !debeNotificar(encontrado.evento, filtro))) {
      next();
      return;
    }

    // El body del request se captura ya: algunos handlers lo reutilizan/mutan después.
    const reqBody = copiaSuperficial(req.body);
    const etiquetaPrevia = etiquetaPreviaParaBorrado(encontrado);
    let resBody: unknown;
    const jsonOriginal = res.json.bind(res);
    res.json = (cuerpo: unknown) => {
      resBody = cuerpo;
      return jsonOriginal(cuerpo);
    };

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      const peticion: PeticionEvento = {
        metodo: req.method as Metodo,
        ruta,
        status: res.statusCode,
        reqBody,
        resBody,
        user: req.user,
        portalUser: req.portalUser,
        etiquetaPrevia,
      };
      void procesar(encontrado, peticion);
    });
  } catch (err) {
    logger.error({ evento: 'grupo_middleware_error', mensaje: err instanceof Error ? err.message : String(err) });
  }
  next();
}

async function procesar(encontrado: NonNullable<ReturnType<typeof buscarEvento>>, peticion: PeticionEvento): Promise<void> {
  try {
    const payload = await construirPayloadGrupo(encontrado, peticion);
    if (payload) await notificarGrupo(payload);
  } catch (err) {
    logger.error({
      evento: 'grupo_notify_error_armado',
      clave: encontrado.evento.clave,
      mensaje: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Copia superficial segura del body (el body nunca se loguea ni se reenvía tal cual). */
function copiaSuperficial(v: unknown): unknown {
  try {
    return v && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : v;
  } catch {
    return undefined;
  }
}
