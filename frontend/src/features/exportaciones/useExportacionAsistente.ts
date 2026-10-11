import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Cliente, PackingListDetalle, PackingListResumen } from '@shared/types/index.js';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { obtenerClientes } from '../../services/cliente-service';
import { guardarPackingList, obtenerPackingList, obtenerPackingLists } from '../../services/packing-list-service';
import { packingListTemporal } from '../../services/packing-list-cola';
import { kgPorLote, type KgLote } from '../../lib/proyeccion-packing';
import { aFilaNumerica, filasDesde, opcionesCliente, valoracionDesde, valoracionVacia, type OpcionCliente, type ValoracionForm } from '../packing-list/formulario';
import { entradaDeExportacion } from './asistente';

export const ID_NUEVA = 'nueva';

export interface EstadoAsistente {
  cargando: boolean;
  error: string | null;
  guardando: boolean;
  /** Packing lists que se pueden elegir (solo los ya guardados en el servidor). */
  packingLists: PackingListResumen[];
  detalle: PackingListDetalle | null;
  clienteId: string;
  valoracion: ValoracionForm;
  kgs: KgLote[];
  opcionesClientes: OpcionCliente[];
  hayClientesInternacionales: boolean;
  sinGuardar: boolean;
  puedeEditar: boolean;
  puedeVerValores: boolean;
}

export interface AccionesAsistente {
  elegirPackingList: (id: string) => Promise<void>;
  cambiarCliente: (id: string) => void;
  cambiarValoracion: (campo: 'estimado' | 'real', lote: string, texto: string) => void;
  cambiarTotalReal: (texto: string) => void;
  /** Guarda lo pendiente; devuelve true si no queda nada sin guardar (listo para seguir). */
  guardar: () => Promise<boolean>;
}

const mensajeDe = (r: { error: string }) => r.error;

/** Estado y guardado del asistente «Nueva exportación». Reutiliza el guardado del packing list (misma versión y validaciones). */
export function useExportacionAsistente(id: string): { estado: EstadoAsistente; acciones: AccionesAsistente } {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const esNueva = id === ID_NUEVA;
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [packingLists, setPackingLists] = useState<PackingListResumen[]>([]);
  const [detalle, setDetalle] = useState<PackingListDetalle | null>(null);
  const [clienteId, setClienteId] = useState('');
  const [valoracion, setValoracion] = useState<ValoracionForm>(valoracionVacia);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const puedeVerValores = tienePermiso('facturacion', 'ver');
  const puedeVerControl = tienePermiso('productos', 'ver') || puedeVerValores;
  const puedeEditar = tienePermiso('despachos', 'editar');

  const aplicar = useCallback((p: PackingListDetalle) => {
    setDetalle(p);
    setClienteId(p.clienteId ?? '');
    setValoracion(valoracionDesde(p));
  }, []);

  useEffect(() => {
    obtenerClientes().then(setClientes);
    if (esNueva) {
      obtenerPackingLists().then(r => {
        if (Array.isArray(r)) setPackingLists(r.filter(p => packingListTemporal(p.id) === null)); else setError(mensajeDe(r));
        setCargando(false);
      });
      return;
    }
    obtenerPackingList(id).then(r => {
      if ('error' in r) setError(r.error); else aplicar(r);
      setCargando(false);
    });
  }, [id, esNueva, aplicar]);

  const kgs = useMemo(() => (detalle ? kgPorLote(filasDesde(detalle).map(aFilaNumerica)) : []), [detalle]);
  const opcionesClientes = useMemo(
    () => opcionesCliente(clientes, clienteId, detalle?.clienteNombre ?? null),
    [clientes, clienteId, detalle?.clienteNombre]
  );
  const sinGuardar = detalle !== null
    && ((detalle.clienteId ?? '') !== clienteId || JSON.stringify(valoracion) !== JSON.stringify(valoracionDesde(detalle)));

  const elegirPackingList = async (idElegido: string) => {
    if (idElegido === '') { setDetalle(null); setClienteId(''); setValoracion(valoracionVacia()); return; }
    const r = await obtenerPackingList(idElegido);
    if ('error' in r) toast.errorMsg(r.error); else aplicar(r);
  };

  const cambiarValoracion = (campo: 'estimado' | 'real', lote: string, texto: string) =>
    setValoracion(v => ({ ...v, [campo]: { ...v[campo], [lote]: texto } }));

  const cambiarTotalReal = (texto: string) => setValoracion(v => ({ ...v, totalReal: texto }));

  const guardar = async (): Promise<boolean> => {
    if (!detalle) return false;
    if (!sinGuardar) return true;
    const r = entradaDeExportacion(detalle, { clienteId, valoracion, puedeVerValores, puedeVerControl });
    if ('error' in r) { toast.errorMsg(r.error); return false; }
    setGuardando(true);
    const res = await guardarPackingList(detalle.id, r.entrada);
    setGuardando(false);
    if ('error' in res) { toast.errorMsg(res.error); return false; }
    toast.exito(res.enCola ? 'Guardado en el teléfono. Se enviará al volver la conexión.' : 'Exportación guardada.');
    aplicar(res.packingList);
    return true;
  };

  return {
    estado: {
      cargando, error, guardando, packingLists, detalle, clienteId, valoracion, kgs, opcionesClientes,
      hayClientesInternacionales: opcionesClientes.length > 0, sinGuardar, puedeEditar, puedeVerValores,
    },
    acciones: { elegirPackingList, cambiarCliente: setClienteId, cambiarValoracion, cambiarTotalReal, guardar },
  };
}
