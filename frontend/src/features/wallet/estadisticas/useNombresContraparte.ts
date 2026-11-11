import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../hooks/use-auth-context';
import { obtenerClientes } from '../../../services/cliente-service';
import { obtenerProveedores } from '../../../services/proveedor-service';

interface Nombres {
  proveedores: ReadonlyMap<string, string>;
  clientes: ReadonlyMap<string, string>;
}

const VACIOS: Nombres = { proveedores: new Map(), clientes: new Map() };

export interface NombresContraparte {
  /** Nombre del proveedor o cliente; null si no se pudo leer (la pantalla muestra "Proveedor" o "Cliente"). */
  nombreDe: (id: string) => string | null;
  /** true mientras se leen los nombres (solo si hay permiso y la agrupación está activa). */
  cargando: boolean;
}

/** Nombres de proveedores y clientes para agrupar gastos por contraparte. Solo se piden si la agrupación está activa y
 *  SOLO si la persona ya tiene permiso de verlos (los mismos permisos que usa Registros); si no, `nombreDe` devuelve null y la
 *  pantalla muestra "Proveedor" o "Cliente". Un fallo al cargar tampoco rompe nada: se usan esos nombres genéricos. */
export function useNombresContraparte(habilitado: boolean): NombresContraparte {
  const { tienePermiso } = useAuth();
  const puedeProveedores = tienePermiso('proveedores', 'ver');
  const puedeClientes = tienePermiso('clientes', 'ver');
  const [nombres, setNombres] = useState<Nombres>(VACIOS);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!habilitado || (!puedeProveedores && !puedeClientes)) return undefined;
    let vigente = true;
    Promise.all([
      puedeProveedores ? obtenerProveedores() : Promise.resolve([]),
      puedeClientes ? obtenerClientes() : Promise.resolve([]),
    ]).then(([p, c]) => {
      if (vigente) setNombres({ proveedores: new Map(p.map(x => [x.id, x.nombre])), clientes: new Map(c.map(x => [x.id, x.nombre])) });
    }).catch(() => { /* sin nombres se muestra "Proveedor" o "Cliente" */ })
      .finally(() => { if (vigente) setListo(true); });
    return () => { vigente = false; };
  }, [habilitado, puedeProveedores, puedeClientes]);

  const nombreDe = useCallback((id: string) => nombres.proveedores.get(id) ?? nombres.clientes.get(id) ?? null, [nombres]);
  return { nombreDe, cargando: habilitado && (puedeProveedores || puedeClientes) && !listo };
}
