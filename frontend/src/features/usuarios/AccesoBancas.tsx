import { useEffect, useState } from 'react';
import { obtenerBancas } from '../../services/banca-service';
import { obtenerBancasDeUsuario } from '../../services/usuario-service';
import { ROLES_CON_TODAS_LAS_BANCAS, accesoATodas, alternarEditar, alternarVer, type AccesoBancasUsuario } from './acceso-bancas';
import type { Banca, RolUsuario } from '@shared/types/index.js';

interface Props {
  usuarioId: string;
  rol: RolUsuario;
  /** Selección vigente (null mientras carga o si no se pudo leer: en ese caso no se guarda nada). */
  onCambio: (acceso: AccesoBancasUsuario | null, modificado: boolean) => void;
}

/**
 * Cuentas y cajas (bancas) que el usuario puede ver y, de ellas, en cuáles además puede registrar o modificar.
 * Sin marcar ninguna = no ve ninguna.
 */
function AccesoBancas({ usuarioId, rol, onCambio }: Props) {
  const veTodas = ROLES_CON_TODAS_LAS_BANCAS.includes(rol);
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [seleccion, setSeleccion] = useState<AccesoBancasUsuario | null>(null);
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
      const acceso = { ver: asignadas.bancaIds, editar: asignadas.bancaIdsEditar };
      setSeleccion(acceso);
      onCambio(acceso, false);
    });
    return () => { vigente = false; };
    // onCambio es estable por diseño del padre (setState); solo se recarga si cambia el usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioId]);

  const cambiar = (acceso: AccesoBancasUsuario) => {
    setSeleccion(acceso);
    onCambio(acceso, true);
  };
  const alternarVerCuenta = (id: string) => { if (seleccion !== null) cambiar(alternarVer(seleccion, id)); };
  const alternarEditarCuenta = (id: string) => { if (seleccion !== null) cambiar(alternarEditar(seleccion, id)); };

  if (veTodas) {
    return (
      <div className="p-3 bg-surface-alt rounded-lg border border-border">
        <p className="text-sm font-medium text-text-primary">Cuentas y cajas</p>
        <p className="text-xs text-text-muted">Este rol ve y edita todas las cuentas y cajas.</p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-primary">Cuentas y cajas: ver y editar</p>
          <p className="text-xs text-text-muted">
            Ver permite consultar la cuenta y sus movimientos. Editar permite además registrar, modificar y anular pagos,
            cobros y movimientos con ella. Sin marcar ninguna, la persona no verá ninguna cuenta.
          </p>
        </div>
        {seleccion !== null && bancas.length > 0 && (
          <div className="flex gap-2 text-xs shrink-0">
            <button type="button" className="text-brand-600 hover:underline" onClick={() => cambiar(accesoATodas(bancas.map(b => b.id)))}>Todas</button>
            <button type="button" className="text-text-secondary hover:underline" onClick={() => cambiar(accesoATodas([]))}>Ninguna</button>
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && seleccion === null && <p className="text-xs text-text-muted">Cargando…</p>}
      {seleccion !== null && bancas.length === 0 && <p className="text-xs text-text-muted">No hay cuentas ni cajas creadas.</p>}
      {seleccion !== null && (
        <ul className="max-h-48 overflow-y-auto space-y-1">
          {bancas.map(b => (
            <li key={b.id} className="flex items-center gap-3 py-1 text-sm text-text-primary">
              <span className="flex-1 min-w-0 truncate">
                {b.nombre} <span className="text-xs text-text-muted">{b.moneda}{b.archivada ? ' · archivada' : ''}</span>
              </span>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={seleccion.ver.includes(b.id)}
                  onChange={() => alternarVerCuenta(b.id)}
                  className="h-4 w-4 accent-brand-600"
                  aria-label={`Ver ${b.nombre}`}
                />
                <span className="text-xs">Ver</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={seleccion.editar.includes(b.id)}
                  onChange={() => alternarEditarCuenta(b.id)}
                  className="h-4 w-4 accent-brand-600"
                  aria-label={`Editar ${b.nombre}`}
                />
                <span className="text-xs">Editar</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AccesoBancas;
