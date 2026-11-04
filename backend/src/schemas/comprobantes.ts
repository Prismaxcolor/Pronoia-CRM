import { z } from 'zod';
import { ENV } from '../config/env.js';
import { esUrlComprobanteValida } from '../utils/comprobante-url.js';

/** URL de un comprobante subido al bucket de este sistema (validación compartida pagos/cobros/cochinito). */
export const comprobanteUrlSchema = z
  .string()
  .url('Comprobante inválido.')
  .refine(u => esUrlComprobanteValida(u, ENV.SUPABASE_URL), 'Comprobante inválido.');
