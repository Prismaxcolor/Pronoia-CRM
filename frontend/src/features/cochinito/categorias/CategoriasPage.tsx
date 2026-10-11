import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Plus, Tags } from 'lucide-react';
import type { CategoriaWallet } from '@shared/types/index.js';
import { Bloque, BotonAccion, EncabezadoPagina, EstadoVacio, Insignia, SkeletonBloque } from '../../../components/ui';
import { useAuth } from '../../../hooks/use-auth-context';
import { useToast } from '../../../hooks/use-toast-context';
import { useConfirm } from '../../../hooks/use-confirm-context';
import { actualizarCategoria } from '../../../services/categoria-wallet-service';
import { LECTURAS } from '../../../lib/offline/prefijos-lectura';
import NavegacionWallet from './NavegacionWallet';
import CategoriaFormModal from './CategoriaFormModal';
import { useCategorias } from './useCategorias';
import { ETIQUETA_TIPO_CATEGORIA, armarArbol } from './categorias-logica';

type Formulario = { categoria: CategoriaWallet | null; padre: CategoriaWallet | null } | null;

const BOTON_ICONO = 'rounded p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

interface FilaProps {
  categoria: CategoriaWallet;
  esSub: boolean;
  puedeCrear: boolean;
  puedeEditar: boolean;
  onEditar: (c: CategoriaWallet) => void;
  onSubcategoria: (c: CategoriaWallet) => void;
  onAlternar: (c: CategoriaWallet) => void;
}

function FilaCategoria({ categoria: c, esSub, puedeCrear, puedeEditar, onEditar, onSubcategoria, onAlternar }: FilaProps) {
  return (
    <li className={`flex flex-wrap items-center gap-2 px-3 py-2 ${esSub ? 'pl-9' : ''} ${c.activo ? '' : 'opacity-60'}`}>
      <span className="h-4 w-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: c.color }} aria-hidden="true" />
      <span className={`text-sm ${esSub ? 'text-text-primary' : 'font-medium text-text-primary'}`}>{c.nombre}</span>
      <Insignia tono="neutral" forma="cuadrada">{ETIQUETA_TIPO_CATEGORIA[c.tipo]}</Insignia>
      {!c.activo && <Insignia tono="aviso" forma="cuadrada">Archivada</Insignia>}
      <span className="ml-auto inline-flex items-center gap-1">
        {!esSub && c.activo && puedeCrear && (
          <button type="button" className={BOTON_ICONO} onClick={() => onSubcategoria(c)} aria-label={`Agregar subcategoría a ${c.nombre}`} title="Agregar subcategoría"><Plus size={14} /></button>
        )}
        {puedeEditar && (
          <>
            <button type="button" className={BOTON_ICONO} onClick={() => onEditar(c)} aria-label={`Editar ${c.nombre}`} title="Editar"><Pencil size={14} /></button>
            <button type="button" className={BOTON_ICONO} onClick={() => onAlternar(c)} aria-label={`${c.activo ? 'Archivar' : 'Restaurar'} ${c.nombre}`} title={c.activo ? 'Archivar' : 'Restaurar'}>
              {c.activo ? <Archive size={14} /> : <ArchiveRestore size={14} />}
            </button>
          </>
        )}
      </span>
    </li>
  );
}

/** Sección "Categorías" del Wallet: crear, editar y archivar categorías y subcategorías de ingresos y egresos. */
function CategoriasPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const { categorias, cargando, error, recargar } = useCategorias();
  const [verArchivadas, setVerArchivadas] = useState(false);
  const [formulario, setFormulario] = useState<Formulario>(null);
  const puedeCrear = tienePermiso('cochinito', 'crear');
  const puedeEditar = tienePermiso('cochinito', 'editar');
  const arbol = useMemo(() => armarArbol(categorias, verArchivadas), [categorias, verArchivadas]);

  const alternarArchivo = async (c: CategoriaWallet) => {
    if (c.activo) {
      const ok = await confirmar({
        titulo: `Archivar "${c.nombre}"`,
        mensaje: c.padreId === null
          ? 'Ya no se ofrecerá al registrar movimientos, junto con sus subcategorías. Los movimientos que ya la usan la conservan y podrás restaurarla cuando quieras.'
          : 'Ya no se ofrecerá al registrar movimientos. Los movimientos que ya la usan la conservan y podrás restaurarla cuando quieras.',
        confirmarLabel: 'Archivar',
        variante: 'warning',
      });
      if (!ok) return;
    }
    const r = await actualizarCategoria(c.id, { activo: !c.activo });
    if ('error' in r) { toast.errorMsg(r.error); return; }
    toast.exito(c.activo ? `"${c.nombre}" archivada.` : `"${c.nombre}" restaurada.`);
    recargar();
  };

  const onGuardado = (modo: 'crear' | 'editar') => {
    setFormulario(null);
    toast.exito(modo === 'crear' ? 'Categoría creada.' : 'Categoría actualizada.');
    recargar();
  };

  const padreDe = (c: CategoriaWallet) => categorias.find(x => x.id === c.padreId) ?? null;

  return (
    <div className="max-w-4xl">
      <EncabezadoPagina
        lecturas={LECTURAS.cochinito}
        titulo="Wallet"
        subtitulo="Categorías y subcategorías para clasificar los ingresos y egresos. El color ayuda a reconocerlas en la tabla de movimientos."
        acciones={puedeCrear ? <BotonAccion soloEnLinea icono={<Plus size={16} />} onClick={() => setFormulario({ categoria: null, padre: null })}>Nueva categoría</BotonAccion> : undefined}
      />
      <NavegacionWallet />
      <Bloque
        titulo="Categorías"
        queEstasViendo="Las categorías de ingresos y egresos, cada una con sus subcategorías. Archivar una la oculta al registrar movimientos pero no cambia los movimientos que ya la usan."
        acciones={
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-text-secondary">
            <input type="checkbox" checked={verArchivadas} onChange={e => setVerArchivadas(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Ver archivadas
          </label>
        }
      >
        {cargando ? <SkeletonBloque alto="h-40" etiqueta="Cargando categorías" /> : error ? (
          <EstadoVacio icono={<Tags size={28} />} mensaje="No se pudieron cargar las categorías" descripcion={error} accion={{ etiqueta: 'Reintentar', onClick: recargar }} />
        ) : arbol.length === 0 ? (
          <EstadoVacio
            icono={<Tags size={28} />}
            mensaje="Aún no hay categorías"
            descripcion="Crea categorías como Servicios, Nómina o Ventas para saber en qué se gasta y de dónde entra el dinero."
            accion={puedeCrear ? { etiqueta: 'Crear la primera categoría', onClick: () => setFormulario({ categoria: null, padre: null }), soloEnLinea: true } : undefined}
          />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {arbol.map(n => (
              <li key={n.categoria.id}>
                <ul>
                  {[n.categoria, ...n.hijas].map(c => (
                    <FilaCategoria
                      key={c.id}
                      categoria={c}
                      esSub={c.padreId !== null}
                      puedeCrear={puedeCrear}
                      puedeEditar={puedeEditar}
                      onEditar={x => setFormulario({ categoria: x, padre: padreDe(x) })}
                      onSubcategoria={x => setFormulario({ categoria: null, padre: x })}
                      onAlternar={alternarArchivo}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Bloque>
      {formulario && <CategoriaFormModal categoria={formulario.categoria} padre={formulario.padre} onClose={() => setFormulario(null)} onGuardado={onGuardado} />}
    </div>
  );
}

export default CategoriasPage;
