import { describe, it, expect } from 'vitest';
import { decidirModoGuardado, puedeEncolarTrasFallo, mensajeGuardadoEnTelefono } from '../../frontend/src/lib/offline/cola-guardado-logica';
import { camposEditables, aplicarCampo } from '../../frontend/src/features/pendientes/campos-editables';

describe('decidirModoGuardado', () => {
  const base = { offlineHabilitado: true, online: false, colaDisponible: true };
  it('solo usa la cola con interruptor activo, IndexedDB y sin red', () => {
    expect(decidirModoGuardado(base)).toBe('cola');
    expect(decidirModoGuardado({ ...base, online: true })).toBe('enlinea');
    expect(decidirModoGuardado({ ...base, offlineHabilitado: false })).toBe('enlinea');
    expect(decidirModoGuardado({ ...base, colaDisponible: false })).toBe('enlinea');
  });

  it('tras un fallo en línea solo encola si fue de red y el modo está habilitado', () => {
    const e = { offlineHabilitado: true, colaDisponible: true, errorDeRed: true };
    expect(puedeEncolarTrasFallo(e)).toBe(true);
    expect(puedeEncolarTrasFallo({ ...e, errorDeRed: false })).toBe(false);
    expect(puedeEncolarTrasFallo({ ...e, offlineHabilitado: false })).toBe(false);
  });

  it('el mensaje de confirmación es claro', () => {
    expect(mensajeGuardadoEnTelefono('PEND-3')).toBe('PEND-3: Guardado en el teléfono: se enviará cuando haya conexión.');
  });
});

describe('campos editables de una operación rechazada', () => {
  const payload = {
    entidadId: '11111111-1111-4111-8111-111111111111',
    observaciones: 'hola',
    clientRequestId: 'x',
    materiales: [{ productoId: '22222222-2222-4222-8222-222222222222', pesoBruto: 100, tara: 5, fotos: ['https://u/1.jpg', 'local:abc'] }],
  };

  it('ofrece solo textos y números corregibles', () => {
    expect(camposEditables(payload).map(c => c.ruta.join('.'))).toEqual(['observaciones', 'materiales.0.pesoBruto', 'materiales.0.tara']);
  });

  it('aplicarCampo no muta el original', () => {
    const nuevo = aplicarCampo(payload, ['materiales', 0, 'pesoBruto'], 80) as typeof payload;
    expect(nuevo.materiales[0].pesoBruto).toBe(80);
    expect(payload.materiales[0].pesoBruto).toBe(100);
  });
});
