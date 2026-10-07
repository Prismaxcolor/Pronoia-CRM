import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, PackageOpen, Plus, Trash2 } from 'lucide-react';
import type { EmpresaPackingList, PackingListResumen } from '@shared/types/index.js';
import { BotonAccion, EncabezadoPagina, EstadoVacio, SkeletonBloque } from '../../components/ui';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import { eliminarPackingList, obtenerEmpresasPackingList, obtenerPackingLists } from '../../services/packing-list-service';
import { formatearFechaDocumento, formatearPeso } from '../../lib/packing-list';
import { OPCIONES_EMBALAJE } from './formulario';
import PackingListEmpresasModal from './PackingListEmpresasModal';
import { nombreYMomento } from '../../lib/fecha-negocio';

const TH = 'px-3 py-2 text-left text-xs font-semibold text-text-secondary whitespace-nowrap';

function PackingListsPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const [lista, setLista] = useState<PackingListResumen[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaPackingList[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalEmpresas, setModalEmpresas] = useState(false);

  const puedeCrear = tienePermiso('despachos', 'crear');
  const puedeEditar = tienePermiso('despachos', 'editar');
  const puedeBorrar = tienePermiso('despachos', 'eliminar');

  const cargar = () => {
    obtenerPackingLists().then(r => {
      if (Array.isArray(r)) { setLista(r); setError(null); } else setError(r.error);
      setCargando(false);
    });
  };

  useEffect(() => {
    cargar();
    obtenerEmpresasPackingList().then(r => { if (Array.isArray(r)) setEmpresas(r); });
  }, []);

  const handleBorrar = async (p: PackingListResumen) => {
    const ok = await confirmar({
      titulo: `Eliminar el packing list ${p.contenedor}`,
      mensaje: 'Se borrará el documento con todas sus paletas. No se puede deshacer.',
      confirmarLabel: 'Eliminar',
      variante: 'danger',
    });
    if (!ok) return;
    const r = await eliminarPackingList(p.id);
    if ('error' in r) { toast.errorMsg(r.error); return; }
    toast.exito('Packing list eliminado.');
    cargar();
  };

  const acciones = (
    <>
      {puedeEditar && <BotonAccion variante="secundario" icono={<Building2 size={16} />} onClick={() => setModalEmpresas(true)}>Datos de la empresa</BotonAccion>}
      {puedeCrear && <BotonAccion icono={<Plus size={16} />} to="/packing-list/nuevo">Nuevo packing list</BotonAccion>}
    </>
  );

  return (
    <div className="max-w-6xl">
      <EncabezadoPagina
        titulo="Packing list de exportación"
        subtitulo="Lista de paletas, pesos y lotes de cada contenedor. Se exporta en español (empresa de Venezuela) y en inglés (empresa de EE.UU.)."
        acciones={acciones}
      />
      {cargando && <SkeletonBloque alto="h-40" etiqueta="Cargando packing lists" />}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!cargando && !error && lista.length === 0 && (
        <EstadoVacio
          mensaje="Todavía no hay packing lists"
          descripcion="Cuando prepares una exportación, arma aquí la lista de paletas del contenedor."
          accion={puedeCrear ? { etiqueta: 'Crear el primer packing list', to: '/packing-list/nuevo' } : undefined}
        />
      )}
      {!cargando && lista.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className={TH}>Contenedor</th>
                <th className={TH}>Fecha</th>
                <th className={TH}>Registrado</th>
                <th className={TH}>Embalaje</th>
                <th className={`${TH} text-right`}>Bultos</th>
                <th className={`${TH} text-right`}>Neto (kg)</th>
                <th className={TH}><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map(p => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    <Link to={`/packing-list/${p.id}`} className="inline-flex items-center gap-2 font-medium text-text-primary hover:text-brand-700 hover:underline">
                      <PackageOpen size={15} aria-hidden="true" /> {p.contenedor}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatearFechaDocumento(p.fecha, 'es')}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{nombreYMomento(p.creadoPorNombre, p.createdAt)}</td>
                  <td className="px-3 py-2">{OPCIONES_EMBALAJE.find(o => o.valor === p.tipoEmbalaje)?.bulto}{p.esPcb ? ' · PCB' : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.totalBultos}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatearPeso(p.totalNeto)}</td>
                  <td className="px-3 py-2 text-right">
                    {puedeBorrar && (
                      <button type="button" onClick={() => handleBorrar(p)} aria-label={`Eliminar ${p.contenedor}`} title="Eliminar"
                        className="p-1.5 rounded-md text-text-muted hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modalEmpresas && (
        <PackingListEmpresasModal empresas={empresas} onClose={() => setModalEmpresas(false)}
          onGuardado={e => { setEmpresas(e); setModalEmpresas(false); }} />
      )}
    </div>
  );
}

export default PackingListsPage;
