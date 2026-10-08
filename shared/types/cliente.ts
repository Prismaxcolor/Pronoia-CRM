/**
 * Cliente frecuente. La empresa es principalmente compradora, pero también
 * factura a algunos clientes recurrentes (ver módulo de facturación).
 * Mantener este registro evita re-tipear datos en cada factura.
 */
export interface Cliente {
  id: string;
  nombre: string;
  /** RIF, cédula o NIT — opcional, formato libre. */
  identificacion: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  notas: string | null;
  activo: boolean;
  creadoPor: string;
  creadoEn: string;
  /** URLs públicas de las fotos del cliente (bucket "clientes" en Storage). */
  fotos: string[];
  /** chat_id de Telegram una vez vinculado (ver integración Telegram). */
  telegramChatId: string | null;
  /** ISO timestamp de cuándo se vinculó, null si nunca se vinculó. */
  telegramLinkedAt: string | null;
}
