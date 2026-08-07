import { useEffect, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Weight } from 'lucide-react';
import { obtenerTaras, desactivarTara, reactivarTara } from '../../services/tara-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import TaraFormModal from './TaraFormModal';
import type { Tara } from '@shared/types/index.js';

function TarasPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('taras', 'crear');
  const puedeEditar = tienePermiso('taras', 'editar');

  const [taras, setTaras] = useState<Tara[]>([]);
  const [cargando, setCargando] = useState(true);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; tara: Tara | null } | { abierto: false }>({ abierto: false });

  const recargar = () => obtenerTaras().then(setTaras).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);

  const handleDesactivar = async (t: Tara) => {
    const result = await desactivarTara(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${t.nombre}" desactivada.`);
    cargar();
  };

  const handleReactivar = async (t: Tara) => {
    const result = await reactivarTara(t.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${t.nombre}" reactivada.`);
    cargar();
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Taras</h1>
          <p className="text-sm text-text-secondary mt-1">
            Pesos de referencia predefinidos (globales), disponibles para todos los usuarios.
          </p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setFormAbierto({ abierto: true, tara: null })}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
          >
            <Plus size={18} />
            Nueva tara
          </button>
        )}
      </div>

      {taras.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay taras registradas.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {taras.map(t => (
            <div key={t.id} className={`flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-b-0 ${!t.activo ? 'opacity-60' : ''}`}>
              <div className="w-11 h-11 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0 overflow-hidden">
                {t.foto ? <img src={t.foto} alt={t.nombre} className="w-full h-full object-cover" /> : <Weight size={18} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary text-sm truncate">{t.nombre}</h3>
                  {!t.activo && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full shrink-0">Inactiva</span>
                  )}
                </div>
                <p className="text-xs text-text-muted">{t.peso.toLocaleString()} kg</p>
              </div>
              {puedeEditar && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setFormAbierto({ abierto: true, tara: t })}
                    className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-brand-600 transition-colors"
                    title="Editar tara"
                  >
                    <Pencil size={15} />
                  </button>
                  {t.activo ? (
                    <button
                      type="button"
                      onClick={() => handleDesactivar(t)}
                      className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-amber-600 transition-colors"
                      title="Desactivar"
                    >
                      <EyeOff size={15} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReactivar(t)}
                      className="p-1.5 rounded-md hover:bg-surface-alt text-text-muted hover:text-green-600 transition-colors"
                      title="Reactivar"
                    >
                      <Eye size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {formAbierto.abierto && (
        <TaraFormModal
          tara={formAbierto.tara}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default TarasPage;
