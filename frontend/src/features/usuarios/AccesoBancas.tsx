import { useEffect, useState } from 'react';
import { obtenerBancas } from '../../services/banca-service';
import { obtenerBancasDeUsuario } from '../../services/usuario-service';
import { ROLES_CON_TODAS_LAS_BANCAS } from './acceso-bancas';
import type { Banca, RolUsuario } from '@shared/types/index.js';

interface Props {
  usuarioId: string;
  rol: RolUsuario;
  /** Selección vigente (null mientras carga o si no se pudo leer: en ese caso no se guarda nada). */
  onCambio: (bancaIds: string[] | null, modificado: boolean) => void;
}

/** Cuentas y cajas (bancas) a las que el usuario tiene acceso en toda la app. Sin marcar ninguna = no ve ninguna. */
function AccesoBancas({ usuarioId, rol, onCambio }: Props) {
  const veTodas = ROLES_CON_TODAS_LAS_BANCAS.includes(rol);
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [seleccion, setSeleccion] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    Promise.all([obtenerBancas({ incluirArchivadas: true }), obtenerBancasDeUsuario(usuarioId)]).then(([lista, asignadas]) => {
      if (!vigente) return;
      setBancas(lista);
      if ('error' in asignadas) {
        setError(asignadas.error);
        onCambio(null, false);
        return;
      }
      setSeleccion(asignadas.bancaIds);
      onCambio(asignadas.bancaIds, false);
    });
    return () => { vigente = false; };
    // onCambio es estable por diseño del padre (setState); solo se recarga si cambia el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioId]);

  const cambiar = (ids: string[]) => {
    setSeleccion(ids);
    onCambio(ids, true);
  };
  const alternar = (id: string) => {
    if (seleccion === null) return;
    cambiar(seleccion.includes(id) ? seleccion.filter(x => x !== id) : [...seleccion, id]);
  };

  if (veTodas) {
    return (
      <div className="p-3 bg-surface-alt rounded-lg border border-border">
        <p className="text-sm font-medium text-text-primary">Cuentas y cajas</p>
        <p className="text-xs text-text-muted">Este rol ve todas las cuentas y cajas.</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-primary">Cuentas y cajas con acceso</p>
          <p className="text-xs text-text-muted">Sin marcar ninguna, la persona no verá ninguna cuenta ni sus movimientos.</p>
        </div>
        {seleccion !== null && bancas.length > 0 && (
          <div className="flex gap-2 text-xs shrink-0">
            <button type="button" className="text-brand-600 hover:underline" onClick={() => cambiar(bancas.map(b => b.id))}>Todas</button>
            <button type="button" className="text-text-secondary hover:underline" onClick={() => cambiar([])}>Ninguna</button>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && seleccion === null && <p className="text-xs text-text-muted">Cargando…</p>}
      {seleccion !== null && bancas.length === 0 && <p className="text-xs text-text-muted">No hay cuentas ni cajas creadas.</p>}
      {seleccion !== null && (
        <ul className="max-h-48 overflow-y-auto space-y-1">
          {bancas.map(b => (
            <li key={b.id}>
              <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={seleccion.includes(b.id)}
                  onChange={() => alternar(b.id)}
                  className="h-4 w-4 accent-brand-600"
                />
                <span>{b.nombre}</span>
                <span className="text-xs text-text-muted">{b.moneda}{b.archivada ? ' · archivada' : ''}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AccesoBancas;
