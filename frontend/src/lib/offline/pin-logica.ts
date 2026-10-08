/** Lógica pura del PIN de desbloqueo local. Solo se guarda un hash derivado con PBKDF2 (sal aleatoria,
 *  iteraciones altas); el PIN nunca se almacena. Todo lo que toca crypto o el reloj se inyecta. */

export const VERSION_PIN = 1;
/** Iteraciones PBKDF2-SHA256. Se guardan en el registro, así se pueden subir sin invalidar PIN viejos. */
export const ITERACIONES_PIN = 310_000;
export const LARGO_SAL_BYTES = 16;
export const MAX_INTENTOS_PIN = 5;
/** Bloqueos acumulados (sin un solo acierto) tras los que se borra la sesión local y se exige login en línea. */
export const MAX_BLOQUEOS_PIN = 10;
/** Primer bloqueo; cada bloqueo consecutivo duplica la espera hasta el tope. */
export const BLOQUEO_BASE_MS = 60_000;
export const BLOQUEO_MAX_MS = 60 * 60_000;
export const LARGO_PIN_MIN = 4;
export const LARGO_PIN_MAX = 8;

export interface RegistroPin {
  v: number;
  usuarioId: string;
  /** base64 */
  sal: string;
  /** base64 */
  hash: string;
  iteraciones: number;
  creadoEn: number;
  intentosFallidos: number;
  /** Bloqueos seguidos sin un acierto: define cuánto dura el siguiente. */
  bloqueos: number;
  bloqueadoHasta: number;
  /** Fallos acumulados desde el último acierto: NO se reinicia con el paso del tiempo ni al terminar un bloqueo. */
  fallosTotales?: number;
  /** Último momento (ms) en que se comprobó un PIN: el reloj efectivo nunca retrocede de ahí. */
  ultimoIntento?: number;
}

export interface DependenciasPin {
  derivar: (pin: string, sal: Uint8Array, iteraciones: number) => Promise<Uint8Array>;
  aleatorios: (n: number) => Uint8Array;
  ahora: () => number;
}

/** PBKDF2-SHA256 con WebCrypto (navegador y Node ≥ 20). */
export const derivarPbkdf2: DependenciasPin['derivar'] = async (pin, sal, iteraciones) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto no disponible: no se puede usar PIN en este navegador.');
  const material = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal as BufferSource, iterations: iteraciones },
    material,
    256,
  );
  return new Uint8Array(bits);
};

export function dependenciasPinPorDefecto(): DependenciasPin {
  return {
    derivar: derivarPbkdf2,
    aleatorios: n => globalThis.crypto.getRandomValues(new Uint8Array(n)),
    ahora: Date.now,
  };
}

export function aBase64(bytes: Uint8Array): string {
  let texto = '';
  bytes.forEach(b => { texto += String.fromCharCode(b); });
  return btoa(texto);
}

export function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  return Uint8Array.from(binario, c => c.charCodeAt(0));
}

/** Comparación sin salida temprana (evita filtrar por tiempo en qué posición difiere). */
export function igualesConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i += 1) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

/** null si el PIN es válido; si no, el mensaje de error para el usuario. */
export function validarFormatoPin(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return 'El PIN solo puede tener números.';
  if (pin.length < LARGO_PIN_MIN || pin.length > LARGO_PIN_MAX) {
    return `El PIN debe tener entre ${LARGO_PIN_MIN} y ${LARGO_PIN_MAX} dígitos.`;
  }
  return null;
}

export function esRegistroPinValido(valor: unknown): valor is RegistroPin {
  if (typeof valor !== 'object' || valor === null) return false;
  const r = valor as Partial<RegistroPin>;
  return r.v === VERSION_PIN
    && typeof r.usuarioId === 'string'
    && typeof r.sal === 'string' && typeof r.hash === 'string'
    && typeof r.iteraciones === 'number' && r.iteraciones > 0
    && typeof r.creadoEn === 'number'
    && typeof r.intentosFallidos === 'number'
    && typeof r.bloqueos === 'number'
    && typeof r.bloqueadoHasta === 'number'
    && (r.fallosTotales === undefined || typeof r.fallosTotales === 'number')
    && (r.ultimoIntento === undefined || typeof r.ultimoIntento === 'number');
}

/** ¿Se agotó el presupuesto de intentos? Cuenta bloqueos y fallos acumulados: adelantar el reloj no los reinicia. */
export function pinAgotado(registro: RegistroPin): boolean {
  return registro.bloqueos >= MAX_BLOQUEOS_PIN || (registro.fallosTotales ?? 0) >= MAX_BLOQUEOS_PIN * MAX_INTENTOS_PIN;
}

export async function crearRegistroPin(pin: string, usuarioId: string, deps: DependenciasPin): Promise<RegistroPin> {
  const error = validarFormatoPin(pin);
  if (error) throw new Error(error);
  const sal = deps.aleatorios(LARGO_SAL_BYTES);
  const hash = await deps.derivar(pin, sal, ITERACIONES_PIN);
  return {
    v: VERSION_PIN,
    usuarioId,
    sal: aBase64(sal),
    hash: aBase64(hash),
    iteraciones: ITERACIONES_PIN,
    creadoEn: deps.ahora(),
    intentosFallidos: 0,
    bloqueos: 0,
    bloqueadoHasta: 0,
    fallosTotales: 0,
    ultimoIntento: deps.ahora(),
  };
}

export function duracionBloqueo(bloqueos: number): number {
  return Math.min(BLOQUEO_BASE_MS * 2 ** Math.max(0, bloqueos - 1), BLOQUEO_MAX_MS);
}

export type ResultadoPin =
  | { ok: true; registro: RegistroPin }
  | { ok: false; motivo: 'incorrecto'; registro: RegistroPin; intentosRestantes: number }
  | { ok: false; motivo: 'bloqueado'; registro: RegistroPin; bloqueadoHasta: number }
  /** Demasiados bloqueos acumulados: el llamador debe borrar la sesión local y exigir login en línea. */
  | { ok: false; motivo: 'agotado'; registro: RegistroPin };

/** Verifica un PIN. Devuelve el registro actualizado (contador de intentos / bloqueo) que el llamador
 *  debe persistir SIEMPRE antes de mostrar el resultado, así recargar la página no reinicia los intentos. */
export async function verificarPin(registro: RegistroPin, pin: string, deps: DependenciasPin): Promise<ResultadoPin> {
  // Reloj monotónico: si el reloj del equipo retrocede, se sigue desde el último intento registrado.
  const ahora = Math.max(deps.ahora(), registro.ultimoIntento ?? 0);
  if (pinAgotado(registro)) return { ok: false, motivo: 'agotado', registro };
  if (registro.bloqueadoHasta > ahora) {
    return { ok: false, motivo: 'bloqueado', registro, bloqueadoHasta: registro.bloqueadoHasta };
  }
  const calculado = aBase64(await deps.derivar(pin, deBase64(registro.sal), registro.iteraciones));
  if (igualesConstante(calculado, registro.hash)) {
    return { ok: true, registro: { ...registro, intentosFallidos: 0, bloqueos: 0, bloqueadoHasta: 0, fallosTotales: 0, ultimoIntento: ahora } };
  }
  const intentos = registro.intentosFallidos + 1;
  const fallosTotales = (registro.fallosTotales ?? 0) + 1;
  if (intentos >= MAX_INTENTOS_PIN) {
    const bloqueos = registro.bloqueos + 1;
    const bloqueadoHasta = ahora + duracionBloqueo(bloqueos);
    const nuevo = { ...registro, intentosFallidos: 0, bloqueos, bloqueadoHasta, fallosTotales, ultimoIntento: ahora };
    if (pinAgotado(nuevo)) return { ok: false, motivo: 'agotado', registro: nuevo };
    return { ok: false, motivo: 'bloqueado', registro: nuevo, bloqueadoHasta };
  }
  const nuevo = { ...registro, intentosFallidos: intentos, fallosTotales, ultimoIntento: ahora };
  return { ok: false, motivo: 'incorrecto', registro: nuevo, intentosRestantes: MAX_INTENTOS_PIN - intentos };
}
