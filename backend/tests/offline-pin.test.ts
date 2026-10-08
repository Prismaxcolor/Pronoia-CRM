import { describe, it, expect } from 'vitest';
import {
  crearRegistroPin, verificarPin, validarFormatoPin, derivarPbkdf2, duracionBloqueo,
  MAX_INTENTOS_PIN, BLOQUEO_BASE_MS, BLOQUEO_MAX_MS, ITERACIONES_PIN, aBase64, deBase64,
  type DependenciasPin,
} from '../../frontend/src/lib/offline/pin-logica';

function deps(reloj: { t: number }): DependenciasPin {
  return {
    // derivación rápida y determinista para no gastar 310 000 iteraciones en cada caso
    derivar: async (pin, sal, it) => new TextEncoder().encode(`${pin}#${Array.from(sal).join('.')}#${it}`),
    aleatorios: n => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256),
    ahora: () => reloj.t,
  };
}

describe('validarFormatoPin', () => {
  it('acepta 4 a 8 dígitos y rechaza el resto', () => {
    expect(validarFormatoPin('1234')).toBeNull();
    expect(validarFormatoPin('12345678')).toBeNull();
    expect(validarFormatoPin('123')).not.toBeNull();
    expect(validarFormatoPin('123456789')).not.toBeNull();
    expect(validarFormatoPin('12a4')).not.toBeNull();
    expect(validarFormatoPin('')).not.toBeNull();
  });
});

describe('PBKDF2 real (WebCrypto)', () => {
  it('es determinista con la misma sal y distinto con otra sal o PIN', async () => {
    const sal = new Uint8Array(16).fill(5);
    const a = await derivarPbkdf2('1234', sal, 1000);
    const b = await derivarPbkdf2('1234', sal, 1000);
    const c = await derivarPbkdf2('1235', sal, 1000);
    const d = await derivarPbkdf2('1234', new Uint8Array(16).fill(6), 1000);
    expect(aBase64(a)).toBe(aBase64(b));
    expect(aBase64(a)).not.toBe(aBase64(c));
    expect(aBase64(a)).not.toBe(aBase64(d));
    expect(a).toHaveLength(32);
  });
});

describe('registro y verificación de PIN', () => {
  it('guarda sal y hash, nunca el PIN, con las iteraciones configuradas', async () => {
    const r = await crearRegistroPin('4821', 'u1', deps({ t: 1 }));
    expect(JSON.stringify(r)).not.toContain('4821');
    expect(r.iteraciones).toBe(ITERACIONES_PIN);
    expect(deBase64(r.sal)).toHaveLength(16);
  });

  it('PIN correcto verifica y reinicia contadores', async () => {
    const d = deps({ t: 1 });
    const r = { ...(await crearRegistroPin('4821', 'u1', d)), intentosFallidos: 3, bloqueos: 1 };
    const res = await verificarPin(r, '4821', d);
    expect(res.ok).toBe(true);
    expect(res.registro).toMatchObject({ intentosFallidos: 0, bloqueos: 0, bloqueadoHasta: 0 });
  });

  it('PIN incorrecto cuenta el intento y avisa cuántos quedan', async () => {
    const d = deps({ t: 1 });
    const r = await crearRegistroPin('4821', 'u1', d);
    const res = await verificarPin(r, '0000', d);
    expect(res).toMatchObject({ ok: false, motivo: 'incorrecto', intentosRestantes: MAX_INTENTOS_PIN - 1 });
    expect(res.registro.intentosFallidos).toBe(1);
  });

  it('al 5.º fallo se bloquea y ni el PIN correcto entra durante el bloqueo', async () => {
    const reloj = { t: 1_000 };
    const d = deps(reloj);
    const r = await crearRegistroPin('4821', 'u1', d);
    let res = await verificarPin(r, '0000', d);
    for (let i = 1; i < MAX_INTENTOS_PIN; i += 1) res = await verificarPin(res.registro, '0000', d);
    expect(res).toMatchObject({ ok: false, motivo: 'bloqueado', bloqueadoHasta: 1_000 + BLOQUEO_BASE_MS });
    const durante = await verificarPin(res.registro, '4821', d);
    expect(durante.ok).toBe(false);
    expect(durante).toMatchObject({ motivo: 'bloqueado' });
  });

  it('pasado el bloqueo se puede reintentar y el siguiente bloqueo dura el doble', async () => {
    const reloj = { t: 0 };
    const d = deps(reloj);
    let registro = await crearRegistroPin('4821', 'u1', d);
    for (let ronda = 1; ronda <= 2; ronda += 1) {
      let res = await verificarPin(registro, '0000', d);
      for (let i = 1; i < MAX_INTENTOS_PIN; i += 1) res = await verificarPin(res.registro, '0000', d);
      expect(res).toMatchObject({ motivo: 'bloqueado', bloqueadoHasta: reloj.t + BLOQUEO_BASE_MS * 2 ** (ronda - 1) });
      reloj.t = (res as { bloqueadoHasta: number }).bloqueadoHasta + 1;
      registro = res.registro;
    }
    expect((await verificarPin(registro, '4821', d)).ok).toBe(true);
  });

  it('el bloqueo tiene tope', () => {
    expect(duracionBloqueo(1)).toBe(BLOQUEO_BASE_MS);
    expect(duracionBloqueo(50)).toBe(BLOQUEO_MAX_MS);
  });

  it('un registro persistido conserva los intentos (recargar la página no los reinicia)', async () => {
    const d = deps({ t: 1 });
    const r = await crearRegistroPin('4821', 'u1', d);
    const tras = await verificarPin(r, '0000', d);
    const recargado = JSON.parse(JSON.stringify(tras.registro));
    const otra = await verificarPin(recargado, '1111', d);
    expect(otra.registro.intentosFallidos).toBe(2);
  });
});
