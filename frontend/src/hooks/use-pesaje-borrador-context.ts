import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { MaterialFila } from '../features/pesaje/material-fila';

export type TipoPesajeBorrador = 'compra' | 'venta' | 'traslado';

/** Campos del formulario "Nuevo pesaje" que se conservan al navegar a otra
 *  pantalla — viven en un Provider por encima de las rutas (Bloque memoria de
 *  pesaje) en vez de en el useState local de PesajePage, que se destruye
 *  cada vez que React Router desmonta la página. */
export interface PesajeBorrador {
  tipo: TipoPesajeBorrador;
  entidadId: string;
  almacenOrigenId: string;
  almacenDestinoId: string;
  fecha: string;
  pesoGlobal: string;
  pesajeExterior: boolean;
  devolucion: string;
  materiales: MaterialFila[];
  observaciones: string;
}

export interface PesajeBorradorContextType {
  borrador: PesajeBorrador;
  setTipo: Dispatch<SetStateAction<TipoPesajeBorrador>>;
  setEntidadId: Dispatch<SetStateAction<string>>;
  setAlmacenOrigenId: Dispatch<SetStateAction<string>>;
  setAlmacenDestinoId: Dispatch<SetStateAction<string>>;
  setFecha: Dispatch<SetStateAction<string>>;
  setPesoGlobal: Dispatch<SetStateAction<string>>;
  setPesajeExterior: Dispatch<SetStateAction<boolean>>;
  setDevolucion: Dispatch<SetStateAction<string>>;
  setMateriales: Dispatch<SetStateAction<MaterialFila[]>>;
  setObservaciones: Dispatch<SetStateAction<string>>;
  /** Vuelve el borrador a su estado inicial — se llama tras guardar con éxito. */
  limpiarBorrador: () => void;
}

export const PesajeBorradorContext = createContext<PesajeBorradorContextType | null>(null);

export function usePesajeBorrador(): PesajeBorradorContextType {
  const ctx = useContext(PesajeBorradorContext);
  if (!ctx) throw new Error('usePesajeBorrador debe usarse dentro de PesajeBorradorProvider');
  return ctx;
}
