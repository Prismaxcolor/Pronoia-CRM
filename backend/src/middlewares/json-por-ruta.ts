import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';

/**
 * Límites del cuerpo JSON. El global es chico a propósito (100 kb) para que ninguna ruta reciba cuerpos enormes;
 * la nómina es la excepción: una semana con hasta 300 renglones y sus cuotas de préstamo puede pasar de 100 kb.
 */
export const LIMITE_JSON_GLOBAL = '100kb';
export const LIMITE_JSON_NOMINA = '1mb';
export const RUTA_NOMINA = '/api/nomina';

const coincide = (ruta: string, prefijo: string): boolean => ruta === prefijo || ruta.startsWith(`${prefijo}/`);

/** Parser JSON global que se SALTA las rutas indicadas (esas montan su propio parser, con su propio límite). */
export function jsonGlobalSaltando(prefijos: readonly string[], limite: string = LIMITE_JSON_GLOBAL): RequestHandler {
  const parser = express.json({ limit: limite });
  return (req: Request, res: Response, next: NextFunction) =>
    prefijos.some(p => coincide(req.path, p)) ? next() : parser(req, res, next);
}

/** Parser de la nómina: se monta DENTRO del router, después de requireAuth, para que solo un usuario autenticado pueda enviar 1 mb. */
export const jsonNomina: RequestHandler = express.json({ limit: LIMITE_JSON_NOMINA });
