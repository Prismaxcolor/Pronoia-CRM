import { useState } from 'react';
import { X } from 'lucide-react';
import type { CategoriaWallet, TipoCategoria } from '@shared/types/index.js';
import { actualizarCategoria, crearCategoria } from '../../../services/categoria-wallet-service';
import { subirImagenCategoria } from '../../../services/storage-service';
import FotoMultiplePicker from '../../../components/FotoMultiplePicker';
import { fotoLocalDeFile, fotosLocalDeUrls, subirFotosLocal, type FotoLocal } from '../../../lib/foto-picker';
import { errorImagenBanca, imagenParaGuardar } from '../imagen-banca';
import SelectorColor from './SelectorColor';
import { COLOR_CATEGORIA_POR_DEFECTO, ETIQUETA_TIPO_CATEGORIA } from './categorias-logica';

interface Props {
  /** Categoría que se edita; null = crear. */
  categoria: CategoriaWallet | null;
  /** Al crear una subcategoría: su categoría. Al editar una subcategoría se deduce de `categoria.padreId`. */
  padre: CategoriaWallet | null;
  onClose: () => void;
  onGuardado: (modo: 'crear' | 'editar') => void;
}

const TIPOS: readonly TipoCategoria[] = ['EGRESO', 'INGRESO', 'AMBOS'];
const CAMPO = 'w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';

/** Sube la imagen elegida y devuelve su URL final; { url: null } si no hay imagen; null si la subida falla. */
async function subirImagenElegida(fotos: FotoLocal[]): Promise<{ url: string | null } | null> {
  if (fotos.length === 0) return { url: null };
  const urls = await subirFotosLocal(fotos, subirImagenCategoria);
  return urls ? { url: urls[0] ?? null } : null;
}

/** Tipos que puede tener: una subcategoría no puede ser más amplia que su categoría. */
const tiposPermitidos = (padre: CategoriaWallet | null): readonly TipoCategoria[] =>
  padre && padre.tipo !== 'AMBOS' ? [padre.tipo] : TIPOS;

function CategoriaFormModal({ categoria, padre, onClose, onGuardado }: Props) {
  const esSub = padre !== null;
  const permitidos = tiposPermitidos(padre);
  const [nombre, setNombre] = useState(categoria?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoCategoria | ''>(categoria?.tipo ?? (permitidos.length === 1 ? permitidos[0] : ''));
  const [color, setColor] = useState(categoria?.color ?? padre?.color ?? COLOR_CATEGORIA_POR_DEFECTO);
  const [fotos, setFotos] = useState<FotoLocal[]>(() => fotosLocalDeUrls(categoria?.imagenUrl ? [categoria.imagenUrl] : []));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Reemplaza la imagen por la recién elegida si es válida; si no, avisa y deja la actual. */
  const elegirImagen = (files: File[]) => {
    const archivo = files[0];
    const problema = archivo ? errorImagenBanca(archivo) : null;
    setError(problema);
    if (archivo && !problema) setFotos([fotoLocalDeFile(archivo)]);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return; }
    if (!tipo) { setError('Elige si es de ingresos, de egresos o de ambos.'); return; }
    setGuardando(true);
    const subida = await subirImagenElegida(fotos);
    if (!subida) {
      setGuardando(false);
      setError('No se pudo subir la imagen. Revisa tu conexión e intenta de nuevo.');
      return;
    }
    // Al editar solo se manda si cambió (undefined = no tocar, null = quitar); al crear solo si hay.
    const imagenUrl = imagenParaGuardar(categoria?.imagenUrl, subida.url);
    const r = categoria
      ? await actualizarCategoria(categoria.id, { nombre: nombre.trim(), tipo, color, ...(imagenUrl !== undefined ? { imagenUrl } : {}) })
      : await crearCategoria({ nombre: nombre.trim(), tipo, color, padreId: padre?.id ?? null, ...(imagenUrl ? { imagenUrl } : {}) });
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    onGuardado(categoria ? 'editar' : 'crear');
  };

  const titulo = categoria ? (esSub ? 'Editar subcategoría' : 'Editar categoría') : (esSub ? 'Nueva subcategoría' : 'Nueva categoría');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-bold text-text-primary">{titulo}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"><X size={20} /></button>
        </div>
        <form onSubmit={enviar} className="p-5 space-y-4">
          {esSub && <p className="text-sm text-text-secondary">Dentro de la categoría <span className="font-medium text-text-primary">{padre.nombre}</span>.</p>}
          <div>
            <label htmlFor="categoria-nombre" className="block text-xs font-medium text-text-secondary mb-1">Nombre</label>
            <input id="categoria-nombre" type="text" required maxLength={80} value={nombre} onChange={e => setNombre(e.target.value)} className={CAMPO} placeholder={esSub ? 'Ej: Electricidad' : 'Ej: Servicios'} />
          </div>
          <div>
            <label htmlFor="categoria-tipo" className="block text-xs font-medium text-text-secondary mb-1">Se usa en</label>
            <select id="categoria-tipo" value={tipo} onChange={e => setTipo(e.target.value as TipoCategoria)} className={CAMPO} disabled={permitidos.length === 1}>
              <option value="">— Elige —</option>
              {permitidos.map(t => <option key={t} value={t}>{ETIQUETA_TIPO_CATEGORIA[t]}</option>)}
            </select>
            {esSub && permitidos.length === 1 && <p className="mt-1 text-xs text-text-muted">Una subcategoría usa el mismo tipo que su categoría.</p>}
          </div>
          <div>
            <FotoMultiplePicker fotos={fotos} max={1} label="Imagen (opcional)" onAgregar={elegirImagen} onQuitar={() => setFotos([])} />
            <p className="text-xs text-text-muted mt-1">Logo o imagen de la categoría. El nombre y el color se conservan. JPG, PNG o WEBP.</p>
          </div>
          <SelectorColor valor={color} onCambiar={setColor} />
          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3"><p className="text-red-600 text-sm">{error}</p></div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover">Cancelar</button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CategoriaFormModal;
