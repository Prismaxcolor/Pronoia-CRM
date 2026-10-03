import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ClipboardList } from 'lucide-react';
import { obtenerTomasFisicas, crearTomaFisica } from '../../services/toma-fisica-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerTiposMaterial } from '../../services/tipo-material-service';
import { obtenerLotes } from '../../services/lote-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import type { TomaFisicaInventario, Almacen, TipoMaterial, Lote } from '@shared/types/index.js';

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Alcance = 'categoria' | 'lote';

const ALCANCES: Array<{ id: Alcance; titulo: string; detalle: string }> = [
  { id: 'categoria', titulo: 'Por categoría', detalle: 'Cuentas los productos de las categorías que elijas (ej. Ferroso, No Ferroso).' },
  { id: 'lote', titulo: 'Por lote', detalle: 'Cuentas lotes completos (ej. PCB, PGM), uno por uno.' },
];

function fmtKg(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Misma regla que el backend/RPC: mismo almacén y alguna categoría en común. */
function tomaAbiertaSolapada(
  tomas: TomaFisicaInventario[],
  almacenId: string,
  categoriaIds: string[]
): TomaFisicaInventario | null {
  return tomas.find(t =>
    t.estado === 'abierta'
    && t.almacenId === almacenId
    && t.categoriaIds.some(c => categoriaIds.includes(c))
  ) ?? null;
}

function NuevaTomaFisicaModal({
  almacenes,
  categorias,
  lotes,
  tomas,
  onClose,
  onCreada,
}: {
  almacenes: Almacen[];
  categorias: TipoMaterial[];
  lotes: Lote[];
  tomas: TomaFisicaInventario[];
  onClose: () => void;
  onCreada: (t: TomaFisicaInventario) => void;
}) {
  const toast = useToast();
  const [almacenId, setAlmacenId] = useState(almacenes.find(a => a.activo)?.id ?? '');
  const [alcance, setAlcance] = useState<Alcance>('categoria');
  const [categoriaIds, setCategoriaIds] = useState<string[]>([]);
  const [loteIds, setLoteIds] = useState<string[]>([]);
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Por categoría solo ofrece categorías "sin lote" (se cuentan producto a
  // producto); por lote solo las "con lote" (PCB, PGM: se pesa el lote
  // completo, no se desarma material por material).
  const categoriasDelAlcance = categorias.filter(c => (alcance === 'categoria' ? c.sinLote : !c.sinLote));
  // La toma física sirve justo para encontrar material que el sistema NO
  // sabe que está ahí — no se exige que el lote ya tenga stock en este
  // almacén para poder elegirlo. Se ofrecen todos los lotes activos y se
  // muestra cuánto tienen hoy en el almacén elegido.
  const lotesActivos = lotes.filter(l => l.activo);
  const stockEnAlmacen = (l: Lote) => l.stockPorAlmacen.find(s => s.almacenId === almacenId)?.stockKg ?? 0;

  const cambiarAlcance = (nuevo: Alcance) => {
    if (nuevo === alcance) return;
    setAlcance(nuevo);
    setCategoriaIds([]);
    setLoteIds([]);
    setError(null);
  };

  const toggleCategoria = (id: string) =>
    setCategoriaIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const toggleLote = (id: string) =>
    setLoteIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const almacenNombre = almacenes.find(a => a.id === almacenId)?.nombre ?? 'el almacén';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!almacenId) { setError('Elige un almacén.'); return; }
    if (categoriaIds.length === 0) {
      setError(alcance === 'categoria' ? 'Elige al menos una categoría a inventariar.' : 'Elige la categoría a la que pertenecen los lotes.');
      return;
    }
    if (alcance === 'lote' && loteIds.length === 0) { setError('Elige al menos un lote a inventariar.'); return; }
    const solapada = tomaAbiertaSolapada(tomas, almacenId, categoriaIds);
    if (solapada) {
      setError(`Ya hay una toma abierta (${solapada.codigo}) con alguna de estas categorías en ${almacenNombre}. Culmínala o cancélala primero.`);
      return;
    }

    setGuardando(true);
    const result = await crearTomaFisica({
      almacenId,
      alcance,
      categoriaIds,
      loteIds: alcance === 'lote' ? loteIds : [],
      descripcion: descripcion.trim() || null,
    });
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${result.tomaFisica.codigo} creada — esas categorías quedan bloqueadas hasta culminarla.`);
    onCreada(result.tomaFisica);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-border">
          <h2 className="text-lg font-bold text-text-primary">Nueva toma física de inventario</h2>
          <p className="text-sm text-text-secondary mt-1">
            Mientras esté abierta, solo se bloquean las categorías elegidas en este almacén —
            el resto sigue operando normal.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Almacén *</label>
            <select value={almacenId} onChange={e => setAlmacenId(e.target.value)} className={inputClass}>
              {almacenes.filter(a => a.activo).map(a => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">¿Qué vas a contar? *</label>
            <div className="grid grid-cols-2 gap-2">
              {ALCANCES.map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => cambiarAlcance(a.id)}
                  aria-pressed={alcance === a.id}
                  className={`text-left p-3 rounded-lg border transition-colors ${alcance === a.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-border hover:bg-surface-alt'}`}
                >
                  <span className="block text-sm font-semibold text-text-primary">{a.titulo}</span>
                  <span className="block text-[11px] text-text-secondary mt-0.5 leading-snug">{a.detalle}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {alcance === 'categoria' ? 'Categorías a inventariar *' : 'Categoría de los lotes *'}
            </label>
            {categoriasDelAlcance.length === 0 ? (
              <p className="text-xs text-amber-700">No hay categorías {alcance === 'categoria' ? 'sin lote' : 'con lote'} configuradas.</p>
            ) : (
              <div className="border border-border rounded-lg divide-y divide-border max-h-40 overflow-y-auto">
                {categoriasDelAlcance.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-alt transition-colors">
                    <input
                      type="checkbox"
                      checked={categoriaIds.includes(c.id)}
                      onChange={() => toggleCategoria(c.id)}
                      className="w-4 h-4 accent-brand-600"
                    />
                    <span className="text-sm text-text-primary">{c.nombre}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {alcance === 'lote' && (
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-brand-800">
                  Lotes a contar * ({loteIds.length} de {lotesActivos.length})
                </label>
                <div className="flex gap-3 text-xs text-brand-700">
                  <button type="button" onClick={() => setLoteIds(lotesActivos.map(l => l.id))} className="hover:underline">Todos</button>
                  <button type="button" onClick={() => setLoteIds([])} className="hover:underline">Ninguno</button>
                </div>
              </div>
              <p className="text-xs text-brand-700/80 mb-2">
                Se muestra cuánto tiene hoy cada lote en {almacenNombre}. Solo se contarán los que marques.
              </p>
              {lotesActivos.length === 0 ? (
                <p className="text-xs text-amber-700">No hay lotes activos todavía.</p>
              ) : (
                <div className="border border-brand-200 rounded-lg divide-y divide-brand-100 max-h-40 overflow-y-auto bg-surface">
                  {lotesActivos.map(l => {
                    const kg = stockEnAlmacen(l);
                    return (
                      <label key={l.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-alt transition-colors">
                        <input
                          type="checkbox"
                          checked={loteIds.includes(l.id)}
                          onChange={() => toggleLote(l.id)}
                          className="w-4 h-4 accent-brand-600"
                        />
                        <span className="text-sm text-text-primary flex-1 min-w-0 truncate">{l.nombre}</span>
                        <span className={`text-xs shrink-0 ${kg > 0 ? 'text-text-secondary' : 'text-text-muted'}`}>
                          {kg > 0 ? `${fmtKg(kg)} kg` : 'sin stock aquí'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Descripción</label>
            <input
              type="text" maxLength={200}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              className={inputClass}
              placeholder="Ej. Cierre de mes agosto 2026 — No Ferroso"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Creando…' : 'Crear e iniciar conteo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TomaFisicaPanel() {
  const navigate = useNavigate();
  const { tienePermiso } = useAuth();
  const puedeCrear = tienePermiso('toma_fisica', 'crear');

  const [tomasFisicas, setTomasFisicas] = useState<TomaFisicaInventario[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [categorias, setCategorias] = useState<TipoMaterial[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalAbierto, setModalAbierto] = useState(false);

  const cargar = () => {
    setCargando(true);
    obtenerTomasFisicas().then(setTomasFisicas).finally(() => setCargando(false));
  };

  useEffect(() => {
    cargar();
    obtenerAlmacenes().then(setAlmacenes);
    obtenerTiposMaterial().then(setCategorias);
    obtenerLotes().then(setLotes);
  }, []);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Tomas físicas de inventario</h2>
          <p className="text-sm text-text-secondary mt-1">
            Conteo físico que reconcilia el stock teórico contra lo realmente contado. Mientras
            una esté abierta, quedan bloqueadas solo las categorías elegidas en ese almacén.
          </p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
          >
            <Plus size={18} />
            Nueva toma física
          </button>
        )}
      </div>

      {cargando ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : tomasFisicas.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay tomas físicas registradas todavía.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {tomasFisicas.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(`/inventario/toma-fisica/${t.id}`)}
              className="w-full flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-b-0 hover:bg-surface-alt transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                <ClipboardList size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary text-sm">{t.codigo}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs shrink-0 ${t.estado === 'abierta' ? 'bg-amber-100 text-amber-700' : t.estado === 'cancelada' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {t.estado === 'abierta' ? 'Abierta' : t.estado === 'cancelada' ? 'Cancelada' : 'Cerrada'}
                  </span>
                </div>
                <p className="text-xs text-text-muted truncate">
                  {t.almacenNombre} · {t.alcance === 'lote' ? 'Por lote' : 'Por categoría'} · {t.categoriaNombres.join(', ')}
                  {t.loteNombres.length > 0 ? ` (${t.loteNombres.join(', ')})` : ''}
                  {t.descripcion ? ` · ${t.descripcion}` : ''}
                </p>
              </div>
              <span className="text-xs text-text-muted shrink-0">
                {t.estado === 'abierta' ? `Abierta ${fmtFecha(t.abiertaEn)}` : t.estado === 'cancelada' ? `Cancelada ${fmtFecha(t.cerradaEn)}` : `Cerrada ${fmtFecha(t.cerradaEn)}`}
              </span>
            </button>
          ))}
        </div>
      )}

      {modalAbierto && (
        <NuevaTomaFisicaModal
          almacenes={almacenes}
          categorias={categorias}
          lotes={lotes}
          tomas={tomasFisicas}
          onClose={() => setModalAbierto(false)}
          onCreada={t => { setModalAbierto(false); cargar(); navigate(`/inventario/toma-fisica/${t.id}`); }}
        />
      )}
    </div>
  );
}

export default TomaFisicaPanel;
