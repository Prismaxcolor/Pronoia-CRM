/** Contrato compartido entre el servicio de solicitudes de llave y los avisos de Telegram. */
export type EstadoSolicitudLlave = 'pendiente' | 'aprobada' | 'rechazada' | 'usada' | 'expirada';

/** Datos mínimos que necesita el aviso a Telegram (no incluye nunca el código de la llave). */
export interface SolicitudLlaveAviso {
  id: string;
  /** Quien pidió la llave; sirve para avisarle por Telegram privado. */
  solicitanteId?: string | null;
  solicitanteNombre: string;
  entidadTipo: string;
  entidadId: string;
  /** Texto legible de lo que se quiere editar, p.ej. "Pago PAG-0042 a Metales SA, 1.520 USD". */
  descripcion: string;
  motivo: string;
  estado: EstadoSolicitudLlave;
  aprobadorNombre?: string | null;
  motivoRechazo?: string | null;
  /** ISO de cuándo vence la llave aprobada (null mientras no se apruebe). */
  llaveExpiraEn?: string | null;
  /** ISO de cuándo vence la solicitud pendiente (null una vez resuelta). */
  venceEn?: string | null;
}

/** Entidades de dinero (las modificaciones de estas van al grupo de cajas; el resto al de operaciones). */
export const ENTIDADES_DINERO_LLAVE: readonly string[] = [
  'pago',
  'cobro',
  'movimiento_banca',
  'nota_ajuste_proveedor',
  'nota_ajuste_cliente',
];

export const esEntidadDinero = (entidadTipo: string): boolean => ENTIDADES_DINERO_LLAVE.includes(entidadTipo);
