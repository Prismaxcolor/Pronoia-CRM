import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const leer = (ruta: string) => readFileSync(resolve(__dirname, '../../frontend/src', ruta), 'utf-8');

describe('idempotencia en el cliente: cableado', () => {
  it.each([
    'services/pago-service.ts', 'services/cobro-service.ts', 'services/nota-ajuste-service.ts',
    'services/nota-ajuste-cliente-service.ts', 'services/factura-cv-service.ts',
  ])('%s acepta clientRequestId en su entrada', ruta => {
    expect(leer(ruta)).toMatch(/clientRequestId\?: string/);
  });

  it.each([
    'features/estado-cuenta/PagoCobroModal.tsx', 'features/estado-cuenta/NotaAjusteModal.tsx', 'features/facturas/FacturaFormPage.tsx',
  ])('%s usa una clave por envío y protege el doble clic', ruta => {
    const fuente = leer(ruta);
    expect(fuente).toMatch(/useIntentoEnvio\(\)/);
    expect(fuente).toMatch(/envio\.iniciar\(\)/);
    expect(fuente).toMatch(/envio\.renovar\(\)/);
    expect(fuente).toMatch(/envio\.terminar\(\)/);
  });

  it('el modal de pago/cobro ya no lanza peticiones sin .catch ni usa vh', () => {
    const fuente = leer('features/estado-cuenta/PagoCobroModal.tsx');
    expect(fuente).not.toMatch(/\.then\(/);
    expect(fuente).not.toMatch(/\d-\[\d+vh\]/);
    expect(fuente).toMatch(/aria-modal="true"/);
    expect(fuente).toMatch(/useCerrarConEscape/);
  });

  it('la carga usa allSettled y se ignora lo que llega tras desmontar', () => {
    const fuente = leer('features/estado-cuenta/usePagoCobroDatos.ts');
    expect(fuente).toMatch(/Promise\.allSettled/);
    expect(fuente).toMatch(/cancelado/);
  });
});
