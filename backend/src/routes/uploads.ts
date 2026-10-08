import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { requireAuth, requirePermiso } from '../middlewares/require-auth.js';
import { logger, clienteIp } from '../utils/logger.js';
import type { Accion, Recurso } from '../utils/permisos.js';
import { detectarFormatoImagen, infoFormatoImagen } from '../utils/firma-imagen.js';

const MIME_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Igual que MAX_BYTES_IMAGEN del cliente (frontend/src/lib/borrador-imagenes.ts): el teléfono sube hasta 6 MB. */
export const TAMANO_MAXIMO = 6 * 1024 * 1024; // 6 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO },
  fileFilter: (_req, file, cb) => {
    if (!MIME_PERMITIDOS.has(file.mimetype)) {
      cb(new Error('Formato no permitido. Usa JPG, PNG o WEBP.'));
      return;
    }
    cb(null, true);
  },
});

/** bucket de Supabase Storage + permiso requerido para cada tipo de imagen. */
const TIPOS: Record<string, { bucket: string; recurso: Recurso; accion: Accion }> = {
  productos: { bucket: 'productos', recurso: 'productos', accion: 'crear' },
  tickets: { bucket: 'tickets', recurso: 'pesaje', accion: 'crear' },
  // Reusa el bucket "tickets" a propósito — misma naturaleza de evidencia
  // fotográfica de pesaje, no amerita un bucket de Storage nuevo.
  traslados: { bucket: 'tickets', recurso: 'traslados', accion: 'crear' },
  taras: { bucket: 'taras', recurso: 'taras', accion: 'crear' },
  comprobantes: { bucket: 'comprobantes', recurso: 'cochinito', accion: 'crear' },
  clientes: { bucket: 'clientes', recurso: 'clientes', accion: 'crear' },
  proveedores: { bucket: 'proveedores', recurso: 'proveedores', accion: 'crear' },
  almacenes: { bucket: 'almacenes', recurso: 'almacenes', accion: 'crear' },
  lotes: { bucket: 'lotes', recurso: 'productos', accion: 'crear' },
};

declare global {
  namespace Express {
    interface Request {
      tipoUpload?: { bucket: string };
    }
  }
}

function resolverTipo(req: Request, res: Response, next: NextFunction) {
  const clave = String(req.params.tipo);
  const tipo = Object.hasOwn(TIPOS, clave) ? TIPOS[clave] : undefined;
  if (!tipo) {
    res.status(404).json({ error: 'Tipo de imagen no reconocido.' });
    return;
  }
  req.tipoUpload = { bucket: tipo.bucket };
  requirePermiso(tipo.recurso, tipo.accion)(req, res, next);
}

function subirArchivoMiddleware(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, err => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Archivo inválido.' });
      return;
    }
    next();
  });
}

const router = Router();

router.use(requireAuth);

router.post('/:tipo', resolverTipo, subirArchivoMiddleware, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Falta el archivo (campo "file").' });
    return;
  }

  // El nombre y el MIME los declara el cliente: el formato, la extensión y el contentType salen de la firma real.
  const formato = detectarFormatoImagen(req.file.buffer);
  const info = formato ? infoFormatoImagen(formato) : null;
  if (!info) {
    res.status(400).json({ error: 'El archivo no es una imagen válida (JPG, PNG o WEBP).' });
    return;
  }

  const bucket = req.tipoUpload!.bucket;
  const nombre = `${randomUUID()}.${info.extension}`;

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(nombre, req.file.buffer, { contentType: info.mime });

  if (error) {
    res.status(500).json({ error: 'No se pudo subir el archivo.' });
    return;
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(nombre);

  logger.info({
    evento: 'archivo_subido',
    ip: clienteIp(req),
    userId: req.user!.sub,
    bucket,
    archivo: nombre,
  });

  res.status(201).json({ url: data.publicUrl });
});

export default router;
