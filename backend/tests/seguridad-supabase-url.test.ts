import { describe, it, expect } from 'vitest';
import { esUrlDeBucketValida, esUrlComprobanteValida } from '../src/utils/comprobante-url.js';
import { validarEnvProduccion } from '../src/config/env.js';

const URL_HTTPS = 'https://cualquier-host.example/storage/v1/object/public/comprobantes/x.png';

describe('esUrlDeBucketValida sin SUPABASE_URL configurado', () => {
  it('rechaza cualquier host https (no hay con qué compararlo)', () => {
    expect(esUrlDeBucketValida(URL_HTTPS, '', 'comprobantes')).toBe(false);
    expect(esUrlComprobanteValida(URL_HTTPS, '')).toBe(false);
  });

  it('con SUPABASE_URL sigue aceptando solo el mismo host', () => {
    expect(esUrlComprobanteValida(URL_HTTPS, 'https://cualquier-host.example')).toBe(true);
    expect(esUrlComprobanteValida(URL_HTTPS, 'https://otro.example')).toBe(false);
  });
});

describe('validarEnvProduccion', () => {
  it('en producción exige SUPABASE_URL', () => {
    expect(() => validarEnvProduccion({ NODE_ENV: 'production', SUPABASE_URL: '' })).toThrow(/SUPABASE_URL/);
  });
  it('en producción con SUPABASE_URL no falla', () => {
    expect(() => validarEnvProduccion({ NODE_ENV: 'production', SUPABASE_URL: 'https://p.supabase.co' })).not.toThrow();
  });
  it('en desarrollo y test no la exige', () => {
    expect(() => validarEnvProduccion({ NODE_ENV: 'development', SUPABASE_URL: '' })).not.toThrow();
    expect(() => validarEnvProduccion({ NODE_ENV: 'test', SUPABASE_URL: '' })).not.toThrow();
  });
});
