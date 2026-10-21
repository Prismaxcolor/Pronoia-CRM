/**
 * Idempotencia en el cliente: un mismo envío del formulario lleva siempre el mismo `clientRequestId`,
 * de modo que un doble clic o un reintento tras un corte de red no duplica la operación en el servidor.
 * La clave se renueva solo cuando el usuario cambia los datos (otra huella) o tras un éxito.
 */

/** UUID v4: crypto.randomUUID si existe; si no (navegadores viejos o contexto no seguro), getRandomValues; último recurso Math.random. */
export function nuevoUuid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface IntentoEnvio {
  /** Resumen de los datos que se enviaron: si cambia, es otra operación. */
  huella: string;
  id: string;
}

/** Reutiliza el intento previo si los datos son los mismos; si no, abre uno nuevo con otra clave. */
export function resolverIntento(
  previo: IntentoEnvio | null,
  huella: string,
  generar: () => string = nuevoUuid,
): IntentoEnvio {
  if (previo !== null && previo.huella === huella) return previo;
  return { huella, id: generar() };
}

/** Huella estable de un valor serializable (las claves se ordenan para que el orden de campos no cambie la huella). */
export function huellaDe(valor: unknown): string {
  return JSON.stringify(valor, (_clave, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  });
}
