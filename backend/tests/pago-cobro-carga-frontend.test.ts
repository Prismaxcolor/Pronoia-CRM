import { describe, it, expect } from 'vitest';
import { faseDeCarga, mensajeErrorCarga, bloqueoPorCarga } from '../../frontend/src/features/estado-cuenta/pago-cobro-carga';
import { esErrorDeCargaDeModulo, textoDeFallo } from '../../frontend/src/lib/error-boundary-logica';
import { MENSAJE_SIN_CONEXION } from '../../frontend/src/lib/mensaje-error';

const ok = <T,>(value: T): PromiseSettledResult<T> => ({ status: 'fulfilled', value });
const fallo = (reason: unknown): PromiseSettledResult<never> => ({ status: 'rejected', reason });

describe('carga de datos del pago/cobro', () => {
  it('con las tres peticiones esenciales bien, está lista', () => {
    expect(faseDeCarga([ok([]), ok([]), ok([])])).toBe('listo');
  });

  it('si falla cualquiera de las esenciales es error (no se confunde con "sin facturas")', () => {
    expect(faseDeCarga([ok([]), fallo(new TypeError('Failed to fetch')), ok([])])).toBe('error');
    expect(faseDeCarga([fallo(new Error('x')), ok([]), ok([])])).toBe('error');
  });

  it('el mensaje de error es amable, en español y sin texto técnico', () => {
    const msg = mensajeErrorCarga([ok([]), fallo(new TypeError('Failed to fetch')), ok([])]);
    expect(msg).toContain(MENSAJE_SIN_CONEXION);
    expect(msg).not.toMatch(/fetch|TypeError/i);
    expect(mensajeErrorCarga([fallo(new Error('Cannot read properties of undefined'))])).not.toMatch(/cannot read/i);
  });

  it('bloquea el envío mientras carga o hay error, y no cuando está lista', () => {
    expect(bloqueoPorCarga('cargando')).toMatch(/cargando/i);
    expect(bloqueoPorCarga('error')).toMatch(/reintentar/i);
    expect(bloqueoPorCarga('listo')).toBeNull();
  });
});

describe('ErrorBoundary: textos', () => {
  it('reconoce el fallo de un import() dinámico', () => {
    expect(esErrorDeCargaDeModulo(new TypeError('Failed to fetch dynamically imported module: https://x/a.js'))).toBe(true);
    expect(esErrorDeCargaDeModulo(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(esErrorDeCargaDeModulo(new Error('boom'))).toBe(false);
    expect(esErrorDeCargaDeModulo('texto')).toBe(false);
  });

  it('el aviso genérico es "Algo salió mal" y nunca muestra el mensaje técnico', () => {
    const t = textoDeFallo(new TypeError("Cannot read properties of undefined (reading 'map')"));
    expect(t.titulo).toBe('Algo salió mal');
    expect(`${t.titulo} ${t.detalle}`).not.toMatch(/cannot read|undefined|map/i);
  });

  it('el fallo de carga de pantalla pide recargar', () => {
    expect(textoDeFallo(new Error('error loading dynamically imported module')).detalle).toMatch(/recarga/i);
  });
});
