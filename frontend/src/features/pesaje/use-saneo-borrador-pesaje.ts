import { useEffect } from 'react';
import type { PesajeBorradorContextType } from '../../hooks/use-pesaje-borrador-context';
import { sanearBorradorPesaje } from './pesaje-saneo';
import type { usePesajeDatos } from './use-pesaje-datos';

type Datos = ReturnType<typeof usePesajeDatos>;

/** Un borrador restaurado puede traer ids de registros que ya no existen o se desactivaron
 *  (tara, lote, material, almacén, proveedor/cliente): se validan una vez, con los catálogos
 *  ya cargados, y lo que no sirva queda sin elegir (con aviso) en vez de pesar/guardar mal. */
export function useSaneoBorradorPesaje(ctx: PesajeBorradorContextType, datos: Datos) {
  const { borrador, saneoPendiente, finalizarSaneo, setMateriales, setLoteFilas, setAlmacenOrigenId, setAlmacenDestinoId, setEntidadId } = ctx;
  const { tipo, materiales, loteFilas, almacenOrigenId, almacenDestinoId, entidadId } = borrador;
  const { catalogosListos, almacenesListos, taras, productos, lotes, almacenes, proveedores, clientes } = datos;

  useEffect(() => {
    if (!saneoPendiente || !catalogosListos || !almacenesListos) return;
    const r = sanearBorradorPesaje({
      tipo, materiales, loteFilas, almacenOrigenId, almacenDestinoId, entidadId,
      taras, productos, lotes, almacenes, proveedores, clientes,
    });
    if (r.materiales) setMateriales(r.materiales);
    if (r.loteFilas) setLoteFilas(r.loteFilas);
    if (r.limpiarAlmacenOrigen) setAlmacenOrigenId('');
    if (r.limpiarAlmacenDestino) setAlmacenDestinoId('');
    if (r.limpiarEntidad) setEntidadId('');
    finalizarSaneo(r.mensaje);
  }, [saneoPendiente, catalogosListos, almacenesListos, taras, productos, lotes, almacenes, proveedores, clientes, tipo, materiales, loteFilas, almacenOrigenId, almacenDestinoId, entidadId, setMateriales, setLoteFilas, setAlmacenOrigenId, setAlmacenDestinoId, setEntidadId, finalizarSaneo]);
}
