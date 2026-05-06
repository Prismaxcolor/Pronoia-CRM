import type { Request, Response, NextFunction } from 'express';
import type { ZodType, ZodError } from 'zod';

/** Valida req.body contra un schema zod. Si falla, responde 400 con detalles. */
export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Datos inválidos.',
        detalles: formatearErrores(result.error),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

function formatearErrores(err: ZodError): Array<{ campo: string; mensaje: string }> {
  return err.issues.map(i => ({
    campo: i.path.join('.') || '(raíz)',
    mensaje: i.message,
  }));
}
