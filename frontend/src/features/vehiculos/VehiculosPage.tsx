import { useEffect, useState } from 'react';
import { Plus, Pencil, EyeOff, Eye, Trash2, Car } from 'lucide-react';
import { obtenerVehiculos, desactivarVehiculo, reactivarVehiculo, eliminarVehiculo } from '../../services/vehiculo-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import VehiculoFormModal from './VehiculoFormModal';
import VisorFotos from '../../components/VisorFotos';
import { etiquetaVehiculo } from '../../lib/vehiculo';
import type { Vehiculo } from '@shared/types/index.js';

/** Datos secundarios en una línea: marca, modelo, color, chofer y descripción. */
function detalle(v: Vehiculo): string {
  return [v.marca, v.modelo, v.color, v.conductor ? `Chofer: ${v.conductor}` : null, v.descripcion].filter(Boolean).join(' · ');
}

const botonIcono = 'p-1.5 rounded-md hover:bg-surface-alt text-text-muted transition-colors';

function VehiculosPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const puedeCrear = tienePermiso('vehiculos', 'crear');
  const puedeEditar = tienePermiso('vehiculos', 'editar');
  const puedeEliminar = tienePermiso('vehiculos', 'eliminar');

  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [visor, setVisor] = useState<{ fotos: string[]; indice: number } | null>(null);
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; vehiculo: Vehiculo | null } | { abierto: false }>({ abierto: false });

  const recargar = () => obtenerVehiculos().then(setVehiculos).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);

  const cambiarEstado = async (v: Vehiculo, activar: boolean) => {
    const result = activar ? await reactivarVehiculo(v.id) : await desactivarVehiculo(v.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${v.nombre}" ${activar ? 'reactivado' : 'desactivado'}.`);
    cargar();
  };

  const handleEliminar = async (v: Vehiculo) => {
    const ok = await confirmar({
      titulo: 'Eliminar vehículo',
      mensaje: `¿Eliminar "${v.nombre}" de la lista? Los tickets ya registrados conservan su placa.`,
      confirmarLabel: 'Eliminar',
      variante: 'danger',
    });
    if (!ok) return;
    const result = await eliminarVehiculo(v.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${v.nombre}" eliminado.`);
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Vehículos</h1>
          <p className="text-sm text-text-secondary mt-1">
            Lista de vehículos propios (global) para elegir al pesar. Los vehículos de terceros se escriben a mano en el pesaje y no se guardan aquí.
          </p>
        </div>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setFormAbierto({ abierto: true, vehiculo: null })}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
          >
            <Plus size={18} />
            Nuevo vehículo
          </button>
        )}
      </div>

      {vehiculos.length === 0 ? (
        <p className="text-center text-text-muted py-12 text-sm">No hay vehículos registrados.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {vehiculos.map(v => (
            <div key={v.id} className={`flex items-center gap-4 px-5 py-3.5 border-b border-border last:border-b-0 ${!v.activo ? 'opacity-60' : ''}`}>
              {v.fotos[0] ? (
                <button
                  type="button"
                  onClick={() => setVisor({ fotos: v.fotos, indice: 0 })}
                  className="relative w-11 h-11 rounded-lg overflow-hidden border border-border shrink-0"
                  title="Ver fotos"
                >
                  <img src={v.fotos[0]} alt={`Foto de ${etiquetaVehiculo(v)}`} className="w-full h-full object-cover" />
                  {v.fotos.length > 1 && (
                    <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[10px] px-1 rounded-tl">{v.fotos.length}</span>
                  )}
                </button>
              ) : (
                <div className="w-11 h-11 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                  <Car size={18} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary text-sm truncate">{v.placa ?? v.nombre}</h3>
                  {v.placa && <span className="text-sm text-text-secondary truncate">· {v.nombre}</span>}
                  {!v.activo && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full shrink-0">Inactivo</span>
                  )}
                </div>
                {detalle(v) && <p className="text-xs text-text-muted truncate">{detalle(v)}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {puedeEditar && (
                  <>
                    <button type="button" onClick={() => setFormAbierto({ abierto: true, vehiculo: v })} className={`${botonIcono} hover:text-brand-600`} title="Editar vehículo">
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => cambiarEstado(v, !v.activo)}
                      className={`${botonIcono} ${v.activo ? 'hover:text-amber-600' : 'hover:text-green-600'}`}
                      title={v.activo ? 'Desactivar' : 'Reactivar'}
                    >
                      {v.activo ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </>
                )}
                {puedeEliminar && (
                  <button type="button" onClick={() => handleEliminar(v)} className={`${botonIcono} hover:text-red-600`} title="Eliminar">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {visor && (
        <VisorFotos fotos={visor.fotos} indice={visor.indice} onCambiar={i => setVisor({ ...visor, indice: i })} onCerrar={() => setVisor(null)} alt="Foto del vehículo ampliada" />
      )}

      {formAbierto.abierto && (
        <VehiculoFormModal
          vehiculo={formAbierto.vehiculo}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}
    </div>
  );
}

export default VehiculosPage;
