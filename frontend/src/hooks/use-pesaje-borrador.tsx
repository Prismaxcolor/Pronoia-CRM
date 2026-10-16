import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { filaVacia, filasDesdeBorrador, type MaterialFila, type FotoMaterial } from '../features/pesaje/material-fila';
import { pesajeGlobalVacio, pesajesDesdeBorrador, type PesajeGlobalFila } from '../features/pesaje/pesaje-global-fila';
import { lotesTrasladoDesdeBorrador, type LoteTrasladoFila } from '../features/pesaje/lote-traslado-fila';
import { difiereEstado } from '../lib/borrador';
import { fechaRestaurable } from '../lib/borrador-vigentes';
import { useAuth } from './use-auth-context';
import { useBorradorPersistente } from './use-borrador-persistente';
import {
  PesajeBorradorContext,
  type PesajeBorrador,
  type TipoPesajeBorrador,
} from './use-pesaje-borrador-context';
import { hoyNegocio } from '../lib/fecha-negocio';

/** Súbela si cambia la forma de PesajeBorrador: los borradores guardados con la anterior se descartan. */
const VERSION_BORRADOR_PESAJE = 1;

function hoyISO(): string {
  return hoyNegocio();
}

function borradorInicial(): PesajeBorrador {
  return {
    tipo: 'compra',
    entidadId: '',
    almacenOrigenId: '',
    almacenDestinoId: '',
    fecha: hoyISO(),
    pesajesGlobales: [pesajeGlobalVacio()],
    pesajeExterior: false,
    devolucion: '',
    fotosDevolucion: [],
    materiales: [filaVacia()],
    observaciones: '',
    vehiculo: '',
    loteFilas: [],
  };
}

/** El estado vive en un componente interno con `key` = usuario: al cambiar de
 *  usuario (cerrar sesión / entrar otro) el borrador en memoria se reinicia y
 *  nunca se mezcla con el de otra persona del mismo equipo. */
export function PesajeBorradorProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  return <PesajeBorradorEstado key={usuario?.id ?? 'sin-sesion'}>{children}</PesajeBorradorEstado>;
}

function PesajeBorradorEstado({ children }: { children: ReactNode }) {
  const [tipo, setTipoRaw] = useState<TipoPesajeBorrador>('compra');
  const [entidadId, setEntidadId] = useState('');
  const [almacenOrigenId, setAlmacenOrigenRaw] = useState('');
  const [almacenDestinoId, setAlmacenDestinoId] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [pesajesGlobales, setPesajesGlobales] = useState<PesajeGlobalFila[]>([pesajeGlobalVacio()]);
  const [pesajeExterior, setPesajeExterior] = useState(false);
  const [devolucion, setDevolucion] = useState('');
  const [fotosDevolucion, setFotosDevolucion] = useState<FotoMaterial[]>([]);
  const [materiales, setMateriales] = useState<MaterialFila[]>([filaVacia()]);
  const [observaciones, setObservaciones] = useState('');
  const [vehiculo, setVehiculo] = useState('');
  const [loteFilas, setLoteFilas] = useState<LoteTrasladoFila[]>([]);
  const [saneoPendiente, setSaneoPendiente] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);

  // Los lotes a trasladar dependen del tipo y del almacén de origen: si
  // cambian por acción del usuario, la selección anterior ya no es válida.
  // La restauración de un borrador usa los setters crudos y no los limpia.
  const setTipo: Dispatch<SetStateAction<TipoPesajeBorrador>> = valor => {
    const nuevo = typeof valor === 'function' ? valor(tipo) : valor;
    if (nuevo !== tipo) setLoteFilas([]);
    setTipoRaw(nuevo);
  };
  const setAlmacenOrigenId: Dispatch<SetStateAction<string>> = valor => {
    const nuevo = typeof valor === 'function' ? valor(almacenOrigenId) : valor;
    if (nuevo !== almacenOrigenId) setLoteFilas([]);
    setAlmacenOrigenRaw(nuevo);
  };

  const aplicarInicial = () => {
    const inicial = borradorInicial();
    setTipoRaw(inicial.tipo);
    setEntidadId(inicial.entidadId);
    setAlmacenOrigenRaw(inicial.almacenOrigenId);
    setAlmacenDestinoId(inicial.almacenDestinoId);
    setFecha(inicial.fecha);
    setPesajesGlobales(inicial.pesajesGlobales);
    setPesajeExterior(inicial.pesajeExterior);
    setDevolucion(inicial.devolucion);
    setFotosDevolucion(inicial.fotosDevolucion);
    setMateriales(inicial.materiales);
    setObservaciones(inicial.observaciones);
    setVehiculo(inicial.vehiculo);
    setLoteFilas(inicial.loteFilas);
  };

  const borrador: PesajeBorrador = {
    tipo, entidadId, almacenOrigenId, almacenDestinoId, fecha,
    pesajesGlobales, pesajeExterior, devolucion, fotosDevolucion, materiales, observaciones, vehiculo, loteFilas,
  };

  const aplicarBorradorGuardado = (d: Partial<PesajeBorrador>) => {
    const base = borradorInicial();
    setTipoRaw(d.tipo ?? base.tipo);
    setEntidadId(d.entidadId ?? '');
    setAlmacenOrigenRaw(d.almacenOrigenId ?? '');
    setAlmacenDestinoId(d.almacenDestinoId ?? '');
    // Una fecha vieja no se restaura en silencio: un pesaje nuevo se registra con la fecha de hoy.
    setFecha(fechaRestaurable(d.fecha, base.fecha));
    setPesajesGlobales(pesajesDesdeBorrador(d.pesajesGlobales));
    setPesajeExterior(!!d.pesajeExterior);
    setDevolucion(d.devolucion ?? '');
    setFotosDevolucion(d.fotosDevolucion ?? []);
    setMateriales(filasDesdeBorrador(d.materiales));
    setObservaciones(d.observaciones ?? '');
    setVehiculo(d.vehiculo ?? '');
    setLoteFilas(lotesTrasladoDesdeBorrador(d.loteFilas));
    // Los ids del borrador se validan contra los catálogos vigentes cuando la pantalla los carga.
    setSaneoPendiente(true);
  };

  const persistente = useBorradorPersistente<PesajeBorrador>({
    formulario: 'pesaje-nuevo',
    version: VERSION_BORRADOR_PESAJE,
    estado: borrador,
    hayCambios: difiereEstado(borrador, borradorInicial()),
    aplicar: aplicarBorradorGuardado,
    restablecer: aplicarInicial,
  });

  /** Vuelve el borrador a su estado inicial y borra la copia guardada — se llama tras guardar con éxito. */
  const limpiarBorrador = () => {
    persistente.limpiar();
    setSaneoPendiente(false);
    setAvisoSaneo(null);
    aplicarInicial();
  };

  return (
    <PesajeBorradorContext.Provider value={{
      borrador,
      setTipo, setEntidadId, setAlmacenOrigenId, setAlmacenDestinoId, setFecha,
      setPesajesGlobales, setPesajeExterior, setDevolucion, setFotosDevolucion, setMateriales, setObservaciones, setVehiculo,
      setLoteFilas,
      limpiarBorrador,
      avisoRestauracion: persistente.aviso,
      descartarBorradorRestaurado: () => { persistente.descartar(); setSaneoPendiente(false); setAvisoSaneo(null); },
      saneoPendiente,
      avisoSaneo,
      finalizarSaneo: mensaje => { setSaneoPendiente(false); setAvisoSaneo(mensaje); },
      cerrarAvisoRestauracion: persistente.cerrarAviso,
    }}>
      {children}
    </PesajeBorradorContext.Provider>
  );
}
