import { useState } from 'react';
import { X } from 'lucide-react';
import type { EmpresaPackingList, IdiomaPackingList } from '@shared/types/index.js';
import { guardarEmpresaPackingList } from '../../services/packing-list-service';
import { useToast } from '../../hooks/use-toast-context';

interface Props {
  empresas: EmpresaPackingList[];
  onClose: () => void;
  onGuardado: (empresas: EmpresaPackingList[]) => void;
}

type Formulario = Record<IdiomaPackingList, { nombre: string; direccion: string; telefono: string; email: string }>;

const TITULOS: Record<IdiomaPackingList, string> = {
  es: 'Documento en español (empresa en Venezuela)',
  en: 'Documento en inglés (empresa en EE.UU.)',
};
const INPUT = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';
const LABEL = 'block text-xs font-medium text-text-secondary mb-1';

function inicial(empresas: EmpresaPackingList[]): Formulario {
  const de = (i: IdiomaPackingList) => {
    const e = empresas.find(x => x.idioma === i);
    return { nombre: e?.nombre ?? '', direccion: e?.direccion ?? '', telefono: e?.telefono ?? '', email: e?.email ?? '' };
  };
  return { es: de('es'), en: de('en') };
}

/** Dirección, teléfono y correo que encabezan cada documento. Se guardan una vez y se reutilizan en todos los packing lists. */
function PackingListEmpresasModal({ empresas, onClose, onGuardado }: Props) {
  const toast = useToast();
  const [form, setForm] = useState<Formulario>(() => inicial(empresas));
  const [guardando, setGuardando] = useState(false);

  const cambiar = (i: IdiomaPackingList, k: keyof Formulario['es'], v: string) =>
    setForm(f => ({ ...f, [i]: { ...f[i], [k]: v } }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    const resultados = await Promise.all((['es', 'en'] as const).map(i => guardarEmpresaPackingList(i, form[i])));
    setGuardando(false);
    const fallo = resultados.find(r => 'error' in r);
    if (fallo && 'error' in fallo) { toast.errorMsg(fallo.error); return; }
    toast.exito('Datos de la empresa guardados.');
    onGuardado(resultados.flatMap(r => ('empresa' in r ? [r.empresa] : [])));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Datos de la empresa" className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Datos de la empresa en el packing list</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {(['es', 'en'] as const).map(i => (
            <fieldset key={i} className="space-y-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-text-primary">{TITULOS[i]}</legend>
              <div>
                <label htmlFor={`emp-nombre-${i}`} className={LABEL}>Nombre de la empresa (opcional)</label>
                <input id={`emp-nombre-${i}`} className={INPUT} maxLength={120} value={form[i].nombre} onChange={e => cambiar(i, 'nombre', e.target.value)} />
              </div>
              <div>
                <label htmlFor={`emp-dir-${i}`} className={LABEL}>Dirección fiscal (una línea por renglón)</label>
                <textarea id={`emp-dir-${i}`} rows={3} className={INPUT} maxLength={400} value={form[i].direccion} onChange={e => cambiar(i, 'direccion', e.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`emp-tel-${i}`} className={LABEL}>Teléfono</label>
                  <input id={`emp-tel-${i}`} className={INPUT} maxLength={60} value={form[i].telefono} onChange={e => cambiar(i, 'telefono', e.target.value)} />
                </div>
                <div>
                  <label htmlFor={`emp-mail-${i}`} className={LABEL}>Correo</label>
                  <input id={`emp-mail-${i}`} type="email" className={INPUT} maxLength={120} value={form[i].email} onChange={e => cambiar(i, 'email', e.target.value)} />
                </div>
              </div>
            </fieldset>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-hover">Cancelar</button>
            <button type="submit" disabled={guardando} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PackingListEmpresasModal;
