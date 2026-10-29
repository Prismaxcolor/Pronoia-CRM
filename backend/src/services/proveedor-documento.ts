import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { idsProveedoresOcultos } from './proveedor-oculto.js';

/**
 * Resuelve de qué proveedor es un documento y comprueba que quien consulta pueda verlo (proveedores ocultos:
 * services/proveedor-oculto.ts). Las rutas por id de un documento (pagos, tickets, facturas, movimientos, notas,
 * auditoría) responden 404 a quien no es superadmin si el proveedor del documento está oculto.
 */

export type DocumentoConProveedor =
  | 'proveedor' | 'factura_compra' | 'ticket_pesaje' | 'pago' | 'movimiento_banca' | 'nota_ajuste_proveedor';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function columnaPor(tabla: string, columna: string, id: string, resultado: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from(tabla).select(resultado).eq(columna, id).limit(1);
  const fila = ((data ?? []) as unknown as Array<Record<string, string | null>>)[0];
  return fila?.[resultado] ?? null;
}

/** Proveedor dueño del documento (null si no tiene o no existe). Lanza si la base falla. */
export async function proveedorDeDocumento(tipo: string, id: string): Promise<string | null> {
  if (!UUID_RE.test(id)) return null;
  switch (tipo) {
    case 'proveedor':
      return id;
    case 'factura_compra':
      return columnaPor('facturas_compra', 'id', id, 'proveedor_id');
    case 'nota_ajuste_proveedor':
      return columnaPor('notas_ajuste_proveedor', 'id', id, 'proveedor_id');
    case 'movimiento_banca':
      return columnaPor('movimientos', 'id', id, 'proveedor_id');
    case 'ticket_pesaje': {
      const { data } = await supabaseAdmin.from('tickets_pesaje').select('tipo, entidad_id').eq('id', id).maybeSingle();
      const t = data as { tipo: string; entidad_id: string | null } | null;
      return t?.tipo === 'compra' ? t.entidad_id : null;
    }
    case 'pago': {
      // Un pago es un grupo de movimientos (grupo_id, o el id del movimiento si es anterior) o un cruce sin dinero.
      const { data } = await supabaseAdmin.from('movimientos').select('proveedor_id').or(`grupo_id.eq.${id},id.eq.${id}`).not('proveedor_id', 'is', null).limit(1);
      const delMovimiento = ((data ?? []) as Array<{ proveedor_id: string | null }>)[0]?.proveedor_id ?? null;
      return delMovimiento ?? columnaPor('cruces', 'grupo_id', id, 'proveedor_id');
    }
    default:
      return null;
  }
}

/** ¿Puede quien consulta ver este documento? Sin proveedores ocultos no consulta nada. Lanza si la base falla. */
export async function documentoVisible(tipo: string, id: string): Promise<boolean> {
  const ocultos = await idsProveedoresOcultos();
  if (ocultos.length === 0) return true;
  const proveedor = await proveedorDeDocumento(tipo, id);
  return !proveedor || !ocultos.includes(proveedor);
}

const NO_ENCONTRADO = 'No encontrado.';

async function responder404OSeguir(ok: () => Promise<boolean>, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!(await ok())) {
      res.status(404).json({ error: NO_ENCONTRADO });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: 'No se pudo verificar el documento. Intenta de nuevo.' });
  }
}

/** Middleware: 404 si el documento de `req.params[param]` es de un proveedor oculto (y quien consulta no es superadmin). */
export function exigirDocumentoVisible(tipo: DocumentoConProveedor, param = 'id'): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) =>
    responder404OSeguir(() => documentoVisible(tipo, String(req.params[param] ?? '')), res, next);
}

/** Middleware: 404 si el body nombra (en `campo`) a un proveedor oculto. Va después de validateBody. */
export function exigirProveedorDelBodyVisible(campo = 'proveedorId', soloSi?: (body: Record<string, unknown>) => boolean): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = body[campo];
    if (typeof id !== 'string' || (soloSi && !soloSi(body))) {
      next();
      return;
    }
    return responder404OSeguir(async () => !(await idsProveedoresOcultos()).includes(id), res, next);
  };
}
