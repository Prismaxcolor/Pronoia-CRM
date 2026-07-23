import { z } from 'zod';

export const portalLoginSchema = z.object({
  /** RIF/cédula o teléfono ya registrado como proveedor/cliente. */
  identificador: z.string().trim().min(3, 'Ingresá tu RIF, cédula o teléfono.'),
});
export type PortalLoginInput = z.infer<typeof portalLoginSchema>;

export const portalVerificarSchema = z.object({
  token: z.string().min(10, 'Link inválido.'),
});
export type PortalVerificarInput = z.infer<typeof portalVerificarSchema>;
