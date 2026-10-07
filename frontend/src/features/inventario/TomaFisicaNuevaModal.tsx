import { useEffect, useState } from 'react';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import AvisoBorrador from '../../components/AvisoBorrador';
import { difiereEstado } from '../../lib/borrador';
import { crearTomaFisica, obtenerLotesElegiblesToma } from '../../services/toma-fisica-service';
import { useToast } from '../../hooks/use-toast-context';
import type { TomaFisicaInventario, Almacen, TipoMaterial, Lote, Producto } from '@shared/types/index.js';

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

export default function NuevaTomaFisicaModal({
  almacenes,
  categorias,
  lotes,
  productos,
  tomas,
  onClose,
  onCreada,
}: {
  almacenes: Almacen[];
  categorias: TipoMaterial[];
  lotes: Lote[];
  productos: Producto[];
  tomas: TomaFisicaInventario[];
  onClose: () => void;
  onCreada: (t: TomaFisicaInventario) => void;
}) {
  const toast = useToast();
  const [almacenId, setAlmacenId] = useState(almacenes.find(a => a.activo)?.id ?? '');
  const [alcance, setAlcance] = useState<Alcance>('categoria');
  const [categoriaIds, setCategoriaIds] = useState<string[]>([]);
  const [loteIds, setLoteIds] = useState<string[]>([]);
  // Materiales que el usuario DESMARCO (todos arrancan marcados). Guardar los excluidos hace que una categoria nueva entre completa.
  const [productosExcluidos, setProductosExcluidos] = useState<string[]>([]);
  // Lotes que corresponden a la(s) categoria(s) de `clave`; se descarta si ya no es la seleccion vigente.
  const [elegibles, setElegibles] = useState<{ clave: string; ids: string[] } | null>(null);
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const almacenInicial = almacenes.find(a => a.activo)?.id ?? '';
  const estadoBorrador = { almacenId, alcance, categoriaIds, loteIds, productosExcluidos, descripcion };
  const restablecer = () => {
    setAlmacenId(almacenInicial);
    setAlcance('categoria');
    setCategoriaIds([]);
    setLoteIds([]);
    setProductosExcluidos([]);
    setDescripcion('');
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'toma-fisica-nueva',
    version: 1,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, { almacenId: almacenInicial, alcance: 'categoria', categoriaIds: [], loteIds: [], productosExcluidos: [], descripcion: '' }),
    aplicar: d => {
      setAlmacenId(almacenes.some(a => a.id === d.almacenId) ? (d.almacenId as string) : almacenInicial);
      setAlcance(d.alcance === 'lote' ? 'lote' : 'categoria');
      setCategoriaIds(d.categoriaIds ?? []);
      setLoteIds(d.loteIds ?? []);
      setProductosExcluidos(d.productosExcluidos ?? []);
      setDescripcion(d.descripcion ?? '');
    },
    restablecer,
  });
  // Cancelar descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  // Por categoría solo ofrece categorías "sin lote" (se cuentan producto a
  // producto); por lote solo las "con lote" (PCB, PGM: se pesa el lote
  // completo, no se desarma material por material).
  // Una categoría con algún producto anclado a un lote se cuenta por lote,
  // aunque esté marcada "sin lote" (mismo criterio que el backend).
  const categoriasDelAlcance = categorias.filter(c => {
    const sinLoteEfectivo = c.sinLote && !c.tieneProductosAnclados;
    return alcance === 'categoria' ? sinLoteEfectivo : !sinLoteEfectivo;
  });
  // La toma física sirve justo para encontrar material que el sistema NO
  // sabe que está ahí — no se exige que el lote ya tenga stock en este
  // almacén para poder elegirlo. Se ofrecen todos los lotes activos y se
  // muestra cuánto tienen hoy en el almacén elegido.
  // Solo los lotes que corresponden a la categoria elegida (PCB sin el Lote 4; PGM solo el Lote 4).
  const loteIdsElegibles = elegibles && elegibles.clave === categoriaIds.join(',') ? elegibles.ids : null;
  const lotesOfrecidos = loteIdsElegibles ? lotes.filter(l => l.activo && loteIdsElegibles.includes(l.id)) : [];
  const stockEnAlmacen = (l: Lote) => l.stockPorAlmacen.find(s => s.almacenId === almacenId)?.stockKg ?? 0;

  const claveCategorias = categoriaIds.join(',');
  useEffect(() => {
    if (alcance !== 'lote' || claveCategorias === '') return;
    let vigente = true;
    obtenerLotesElegiblesToma(claveCategorias.split(',')).then(ids => {
      if (!vigente) return;
      setElegibles({ clave: claveCategorias, ids });
      setLoteIds(prev => prev.filter(id => ids.includes(id)));
    });
    return () => { vigente = false; };
  }, [alcance, claveCategorias]);

  // Por categoria: materiales activos de las categorias elegidas, con casilla cada uno.
  const productosDeCategorias = alcance === 'categoria'
    ? productos
        .filter(p => p.activo && categoriaIds.includes(p.tipoMaterialId ?? ''))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    : [];
  const productosElegidos = productosDeCategorias.filter(p => !productosExcluidos.includes(p.id));
  const toggleProducto = (id: string) =>
    setProductosExcluidos(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const marcarTodosProductos = (marcar: boolean) =>
    setProductosExcluidos(prev => {
      const visibles = productosDeCategorias.map(p => p.id);
      return marcar ? prev.filter(id => !visibles.includes(id)) : [...new Set([...prev, ...visibles])];
    });

  const cambiarAlcance = (nuevo: Alcance) => {
    if (nuevo === alcance) return;
    setAlcance(nuevo);
    setCategoriaIds([]);
    setLoteIds([]);
    setProductosExcluidos([]);
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
    if (alcance === 'categoria' && productosDeCategorias.length > 0 && productosElegidos.length === 0) {
      setError('Elige al menos un material a inventariar.');
      return;
    }
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
      // Solo si se desmarco alguno; sin lista, la toma cuenta toda la categoria.
      ...(alcance === 'categoria' && productosElegidos.length < productosDeCategorias.length
        ? { productoIds: productosElegidos.map(p => p.id) }
        : {}),
      descripcion: descripcion.trim() || null,
    });
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    toast.exito(`${result.tomaFisica.codigo} creada — esas categorías quedan bloqueadas hasta culminarla.`);
    borrador.limpiar();
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
          <AvisoBorrador formulario="la nueva toma física" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
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
              <p className="text-xs text-amber-700">No hay categorías {alcance === 'categoria' ? 'sin productos anclados a un lote' : 'con productos anclados a un lote'}.</p>
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

          {alcance === 'categoria' && productosDeCategorias.length > 0 && (
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-brand-800">
                  Materiales a contar * ({productosElegidos.length} de {productosDeCategorias.length})
                </label>
                <div className="flex gap-3 text-xs text-brand-700">
                  <button type="button" onClick={() => marcarTodosProductos(true)} className="hover:underline">Seleccionar todos</button>
                  <button type="button" onClick={() => marcarTodosProductos(false)} className="hover:underline">Deseleccionar todos</button>
                </div>
              </div>
              <p className="text-xs text-brand-700/80 mb-2">
                Solo se contarán (y se ajustarán al culminar) los materiales que dejes marcados.
              </p>
              <div className="border border-brand-200 rounded-lg divide-y divide-brand-100 max-h-48 overflow-y-auto bg-surface">
                {productosDeCategorias.map(p => (
                  <label key={p.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-alt transition-colors">
                    <input
                      type="checkbox"
                      checked={!productosExcluidos.includes(p.id)}
                      onChange={() => toggleProducto(p.id)}
                      className="w-4 h-4 accent-brand-600"
                    />
                    <span className="text-sm text-text-primary flex-1 min-w-0 truncate">{p.nombre}</span>
                    {categoriaIds.length > 1 && (
                      <span className="text-xs text-text-muted shrink-0">{p.tipoMaterialNombre}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {alcance === 'lote' && (
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-brand-800">
                  Lotes a contar * ({loteIds.length} de {lotesOfrecidos.length})
                </label>
                <div className="flex gap-3 text-xs text-brand-700">
                  <button type="button" onClick={() => setLoteIds(lotesOfrecidos.map(l => l.id))} className="hover:underline">Todos</button>
                  <button type="button" onClick={() => setLoteIds([])} className="hover:underline">Ninguno</button>
                </div>
              </div>
              <p className="text-xs text-brand-700/80 mb-2">
                Se muestra cuánto tiene hoy cada lote en {almacenNombre}. Solo se contarán los que marques.
              </p>
              {categoriaIds.length === 0 ? (
                <p className="text-xs text-amber-700">Elige primero la categoría para ver sus lotes.</p>
              ) : loteIdsElegibles === null ? (
                <p className="text-xs text-text-secondary">Cargando lotes…</p>
              ) : lotesOfrecidos.length === 0 ? (
                <p className="text-xs text-amber-700">No hay lotes activos para esta categoría.</p>
              ) : (
                <div className="border border-brand-200 rounded-lg divide-y divide-brand-100 max-h-40 overflow-y-auto bg-surface">
                  {lotesOfrecidos.map(l => {
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
            <button type="button" onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
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
