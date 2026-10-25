import { z } from 'zod';

const MAX_DESCRIPCION = 200;
const MAX_PLACA = 20;
const MAX_CAMPO_CORTO = 60;
const MAX_FOTOS = 10;

/** Placa en mayúsculas, sin espacios en los extremos y con los internos colapsados.
 *  Espejo en frontend/src/lib/vehiculo.ts (normalizarPlacaFront). */
export function normalizarPlaca(valor: string): string {
  return valor.trim().replace(/\s+/g, ' ').toUpperCase();
}

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v && v.length > 0 ? v : null));

const fotosSchema = z.array(z.string().url('URL de foto inválida.')).max(MAX_FOTOS, `Máximo ${MAX_FOTOS} fotos.`);

export const crearVehiculoSchema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
  /** Obligatoria al crear; los vehículos antiguos sin placa se editan con placaOpcional. */
  placa: z
    .string()
    .trim()
    .min(1, 'La placa es obligatoria.')
    .max(MAX_PLACA)
    .transform(normalizarPlaca),
  marca: textoOpcional(MAX_CAMPO_CORTO),
  modelo: textoOpcional(MAX_CAMPO_CORTO),
  color: textoOpcional(MAX_CAMPO_CORTO),
  /** Chofer habitual. */
  conductor: textoOpcional(MAX_CAMPO_CORTO),
  /** Tipo o descripción libre (ej. "Camión 350", "Rastra"). Opcional. */
  descripcion: textoOpcional(MAX_DESCRIPCION),
  // Sin .default([]): con .partial() en el PATCH dejaría "fotos" siempre
  // presente y borraría las fotos existentes. El servicio aplica el default.
  fotos: fotosSchema.optional(),
});

// En edición la placa puede ir vacía (queda null) para tolerar los vehículos
// antiguos que nunca tuvieron una; la UI la exige cuando el vehículo ya la tiene.
const placaEdicion = z
  .string()
  .trim()
  .max(MAX_PLACA)
  .transform(v => (v.length > 0 ? normalizarPlaca(v) : null));

export const actualizarVehiculoSchema = crearVehiculoSchema
  .extend({ activo: z.boolean().optional(), placa: placaEdicion })
  .partial()
  .refine(
    data => Object.keys(data).length > 0,
    { message: 'Debes enviar al menos un campo a actualizar.' }
  );

export type CrearVehiculoInput = z.infer<typeof crearVehiculoSchema>;
export type ActualizarVehiculoInput = z.infer<typeof actualizarVehiculoSchema>;
