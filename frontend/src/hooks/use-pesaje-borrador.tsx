import { useState, type ReactNode } from 'react';
import { filaVacia, type MaterialFila } from '../features/pesaje/material-fila';
import {
  PesajeBorradorContext,
  type PesajeBorrador,
  type TipoPesajeBorrador,
} from './use-pesaje-borrador-context';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function borradorInicial(): PesajeBorrador {
  return {
    tipo: 'compra',
    entidadId: '',
    almacenOrigenId: '',
    almacenDestinoId: '',
    fecha: hoyISO(),
    pesoGlobal: '',
    pesajeExterior: false,
    devolucion: '',
    materiales: [filaVacia()],
    observaciones: '',
  };
}

export function PesajeBorradorProvider({ children }: { children: ReactNode }) {
  const [tipo, setTipo] = useState<TipoPesajeBorrador>('compra');
  const [entidadId, setEntidadId] = useState('');
  const [almacenOrigenId, setAlmacenOrigenId] = useState('');
  const [almacenDestinoId, setAlmacenDestinoId] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [pesoGlobal, setPesoGlobal] = useState('');
  const [pesajeExterior, setPesajeExterior] = useState(false);
  const [devolucion, setDevolucion] = useState('');
  const [materiales, setMateriales] = useState<MaterialFila[]>([filaVacia()]);
  const [observaciones, setObservaciones] = useState('');

  const limpiarBorrador = () => {
    const inicial = borradorInicial();
    setTipo(inicial.tipo);
    setEntidadId(inicial.entidadId);
    setAlmacenOrigenId(inicial.almacenOrigenId);
    setAlmacenDestinoId(inicial.almacenDestinoId);
    setFecha(inicial.fecha);
    setPesoGlobal(inicial.pesoGlobal);
    setPesajeExterior(inicial.pesajeExterior);
    setDevolucion(inicial.devolucion);
    setMateriales(inicial.materiales);
    setObservaciones(inicial.observaciones);
  };

  const borrador: PesajeBorrador = {
    tipo, entidadId, almacenOrigenId, almacenDestinoId, fecha,
    pesoGlobal, pesajeExterior, devolucion, materiales, observaciones,
  };

  return (
    <PesajeBorradorContext.Provider value={{
      borrador,
      setTipo, setEntidadId, setAlmacenOrigenId, setAlmacenDestinoId, setFecha,
      setPesoGlobal, setPesajeExterior, setDevolucion, setMateriales, setObservaciones,
      limpiarBorrador,
    }}>
      {children}
    </PesajeBorradorContext.Provider>
  );
}
