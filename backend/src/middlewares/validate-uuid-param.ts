import type { RequestHandler } from 'express';
import { z } from 'zod';

const uuidSchema = z.string().uuid();

/** 400 si el parámetro de ruta indicado no es un UUID. */
export function validarUuidParam(nombre = 'id'): RequestHandler {
  return (req, res, next) => {
    if (!uuidSchema.safeParse(req.params[nombre]).success) {
      res.status(400).json({ error: 'Identificador inválido.' });
      return;
    }
    next();
  };
}
