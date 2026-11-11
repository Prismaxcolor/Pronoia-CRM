import { z } from 'zod';
import { ENV } from '../config/env.js';
import { esUrlDeBucketValida } from '../utils/comprobante-url.js';

/** Extensiones que el endpoint de subida asigna según la firma real del archivo (nunca SVG). */
const EXTENSION_IMAGEN = /\.(jpe?g|png|webp)$/i;

/**
 * Imagen (logo / foto) que se muestra junto al nombre de un proveedor o cliente: URL de una imagen subida vía
 * POST /api/uploads/{proveedores|clientes}. Opcional; null = sin imagen (en un PATCH, null la quita).
 */
export const imagenTerceroSchema = (bucket: 'proveedores' | 'clientes') =>
  z
    .string()
    .url('Imagen inválida.')
    .refine(u => esUrlDeBucketValida(u, ENV.SUPABASE_URL, bucket) && EXTENSION_IMAGEN.test(u), 'Imagen inválida.')
    .nullable()
    .optional();
