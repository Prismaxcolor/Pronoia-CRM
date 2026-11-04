import { describe, it, expect } from 'vitest';
import { planLiberacionVistasPrevias, vistasPreviasVigentes, type FotoLocal } from '../../frontend/src/lib/foto-picker';

const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
const nueva = (preview: string): FotoLocal => ({ tipo: 'nueva', file, preview });
const existente = (url: string): FotoLocal => ({ tipo: 'existente', url });

describe('vistasPreviasVigentes', () => {
  it('solo cuenta las fotos nuevas; las ya subidas no tienen vista previa local', () => {
    expect([...vistasPreviasVigentes([nueva('blob:1'), existente('https://x/a.jpg'), nueva('blob:2')])]).toEqual(['blob:1', 'blob:2']);
  });
  it('lista vacía: no hay vigentes', () => {
    expect(vistasPreviasVigentes([]).size).toBe(0);
  });
});

describe('planLiberacionVistasPrevias', () => {
  it('libera la vista previa de la foto que se quitó y conserva las demás', () => {
    const plan = planLiberacionVistasPrevias(new Set(['blob:1', 'blob:2']), [nueva('blob:2')]);
    expect(plan.liberar).toEqual(['blob:1']);
    expect([...plan.vigentes]).toEqual(['blob:2']);
  });
  it('no libera nada si todas siguen presentes', () => {
    expect(planLiberacionVistasPrevias(new Set(['blob:1']), [nueva('blob:1')]).liberar).toEqual([]);
  });
  it('una foto nueva recién agregada pasa a vigente sin liberar nada', () => {
    const plan = planLiberacionVistasPrevias(new Set(), [nueva('blob:9')]);
    expect(plan.liberar).toEqual([]);
    expect(plan.vigentes.has('blob:9')).toBe(true);
  });
  it('si se vacía la lista (guardar o cancelar) se liberan todas', () => {
    expect(planLiberacionVistasPrevias(new Set(['blob:1', 'blob:2']), []).liberar).toEqual(['blob:1', 'blob:2']);
  });
  it('las fotos existentes (URL remota) nunca se liberan', () => {
    expect(planLiberacionVistasPrevias(new Set(), [existente('https://x/a.jpg')]).liberar).toEqual([]);
  });
});
