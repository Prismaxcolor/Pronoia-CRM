import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Banca, Movimiento } from '@shared/types/index.js';
import { obtenerBancasOError } from '../../../services/banca-service';
import { leerGet } from '../../../services/lectura-service';
import { obtenerProveedores } from '../../../services/proveedor-service';
import { obtenerClientes } from '../../../services/cliente-service';
import { ESPERA_TOTALES_MS, LIMITES_CACHE, recortarCampo, ultimasFilas } from '../../../lib/offline/lectura-logica';
import { useAuth } from '../../../hooks/use-auth-context';
import type { NombreContraparte } from '../../../lib/cochinito-kpis';
import { deduplicarPorId } from './registros-logica';

/** Igual que obtenerMovimientos() de banca-service, pero si la carga falla lanza el error en vez de devolver una
 *  lista vacía: la pantalla debe distinguir "no se pudo cargar" de "no hay registros". */
async function cargarMovimientosOError(): Promise<Movimiento[]> {
  const { movimientos } = await leerGet<{ movimientos: Movimiento[] }>('/api/cochinito/movimientos', {
    recortar: d => recortarCampo(d, 'movimientos', f => ultimasFilas(f as Movimiento[], LIMITES_CACHE.maxMovimientos, m => m.fecha)),
    esperaMs: ESPERA_TOTALES_MS,
  });
  return deduplicarPorId(movimientos);
}

interface Datos {
  bancas: Banca[];
  movimientos: Movimiento[];
}

/**
 * Datos de Registros: cuentas (incluye archivadas, para poder nombrar movimientos viejos), movimientos y los nombres
 * de proveedores/clientes (solo con permiso de verlos; si fallan, la fila muestra solo el rol).
 * `cargando` solo es true en la primera carga (o el reintento tras un error): al recargar tras una acción los datos viejos
 * siguen en pantalla (`recargando`) hasta que lleguen los nuevos, sin esqueleto ni perder el scroll. Si esa recarga falla se
 * conservan los datos viejos y `errorRecarga` es true.
 * `error` solo es true si falló la carga inicial de cuentas o movimientos.
 */
export function useRegistrosWallet() {
  const { tienePermiso } = useAuth();
  const puedeVerProveedores = tienePermiso('proveedores', 'ver');
  const puedeVerClientes = tienePermiso('clientes', 'ver');
  const [datos, setDatos] = useState<Datos>({ bancas: [], movimientos: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [recargando, setRecargando] = useState(false);
  const [errorRecarga, setErrorRecarga] = useState(false);
  const tieneDatos = useRef(false);
  const [intento, setIntento] = useState(0);
  const [nombres, setNombres] = useState<{ proveedores: ReadonlyMap<string, string>; clientes: ReadonlyMap<string, string> }>(
    { proveedores: new Map(), clientes: new Map() },
  );

  useEffect(() => {
    let vigente = true;
    Promise.all([obtenerBancasOError({ incluirArchivadas: true }), cargarMovimientosOError()])
      .then(([bancas, movimientos]) => {
        if (!vigente) return;
        tieneDatos.current = true;
        setDatos({ bancas, movimientos });
        setError(false);
        setErrorRecarga(false);
      })
      .catch(() => { if (vigente) { if (tieneDatos.current) setErrorRecarga(true); else setError(true); } })
      .finally(() => { if (vigente) { setCargando(false); setRecargando(false); } });
    return () => { vigente = false; };
  }, [intento]);

  useEffect(() => {
    let vigente = true;
    Promise.all([
      puedeVerProveedores ? obtenerProveedores() : Promise.resolve([]),
      puedeVerClientes ? obtenerClientes() : Promise.resolve([]),
    ]).then(([p, c]) => {
      if (vigente) setNombres({ proveedores: new Map(p.map(x => [x.id, x.nombre])), clientes: new Map(c.map(x => [x.id, x.nombre])) });
    }).catch(() => { /* sin nombres la fila muestra solo "Proveedor" o "Cliente" */ });
    return () => { vigente = false; };
  }, [puedeVerProveedores, puedeVerClientes]);

  const nombreContraparte = useCallback<NombreContraparte>(
    m => (m.proveedorId ? nombres.proveedores.get(m.proveedorId) : m.clienteId ? nombres.clientes.get(m.clienteId) : null) ?? null,
    [nombres],
  );

  const nombresCuentas = useMemo(() => new Map(datos.bancas.map(b => [b.id, b.nombre])), [datos.bancas]);
  const monedasCuentas = useMemo(() => new Map(datos.bancas.map(b => [b.id, b.moneda])), [datos.bancas]);
  const recargar = useCallback(() => {
    if (tieneDatos.current) setRecargando(true); else setCargando(true);
    setErrorRecarga(false);
    setIntento(n => n + 1);
  }, []);

  return { ...datos, cargando, recargando, error, errorRecarga, recargar, nombreContraparte, nombresCuentas, monedasCuentas };
}
