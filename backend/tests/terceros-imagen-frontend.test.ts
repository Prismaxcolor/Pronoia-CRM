import { describe, it, expect, vi } from 'vitest';
import { fotosLocalDeUrls, type FotoLocal } from '../../frontend/src/lib/foto-picker';
import { subirImagenTercero } from '../../frontend/src/features/proveedores/imagen-tercero';
import { imagenParaGuardar } from '../../frontend/src/features/cochinito/imagen-banca';
import { unirSaldos, type TerceroBase } from '../../frontend/src/lib/terceros-kpis';

const URL_ACTUAL = 'https://p.supabase.test/storage/v1/object/public/proveedores/a.png';
const tercero = (extra: Partial<TerceroBase> = {}): TerceroBase => ({
  id: 't1', nombre: 'Acme', identificacion: null, telefono: null, email: null, activo: true, telegramChatId: null, telegramLinkedAt: null, ...extra,
});

describe('subirImagenTercero', () => {
  it('sin imagen elegida no sube nada y el resultado es null', async () => {
    const subir = vi.fn();
    expect(await subirImagenTercero([], subir)).toEqual({ url: null });
    expect(subir).not.toHaveBeenCalled();
  });
  it('una imagen ya subida (URL existente) se conserva sin volver a subirla', async () => {
    const subir = vi.fn();
    expect(await subirImagenTercero(fotosLocalDeUrls([URL_ACTUAL]), subir)).toEqual({ url: URL_ACTUAL });
    expect(subir).not.toHaveBeenCalled();
  });
  it('si la subida falla devuelve null (el formulario avisa y no guarda)', async () => {
    const archivo = new File(['x'], 'logo.png', { type: 'image/png' });
    const subir = vi.fn().mockResolvedValue(null);
    expect(await subirImagenTercero([{ tipo: 'nueva', file: archivo, preview: 'blob:x' } satisfies FotoLocal], subir)).toBeNull();
  });
});

describe('imagen del tercero al guardar', () => {
  it('sin cambios no se manda; quitarla manda null; una nueva manda la URL', () => {
    expect(imagenParaGuardar(URL_ACTUAL, URL_ACTUAL)).toBeUndefined();
    expect(imagenParaGuardar(URL_ACTUAL, null)).toBeNull();
    expect(imagenParaGuardar(null, URL_ACTUAL)).toBe(URL_ACTUAL);
    expect(imagenParaGuardar(undefined, null)).toBeUndefined();
  });
  it('unirSaldos conserva la imagen del tercero en la fila', () => {
    const [fila] = unirSaldos([tercero({ imagenUrl: URL_ACTUAL })], null);
    expect(fila.imagenUrl).toBe(URL_ACTUAL);
  });
});
