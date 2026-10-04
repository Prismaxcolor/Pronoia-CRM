import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { MaterialFila, FotoMaterial } from '../features/pesaje/material-fila';
import type { PesajeGlobalFila } from '../features/pesaje/pesaje-global-fila';
import type { LoteTrasladoFila } from '../features/pesaje/lote-traslado-fila';
import type { AvisoBorrador } from './use-borrador-persistente';

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
  /** Desglose de pesadas individuales — el peso global final es la suma de
   *  (peso - tara) de todas. Vacío cuando pesajeExterior es true. */
  pesajesGlobales: PesajeGlobalFila[];
  pesajeExterior: boolean;
  devolucion: string;
  fotosDevolucion: FotoMaterial[];
  materiales: MaterialFila[];
  observaciones: string;
  /** Placa/identificador del vehículo — aplica a compra, venta y traslado. */
  vehiculo: string;
  /** Lotes (PCB) a trasladar completos — solo aplica a traslado. */
  loteFilas: LoteTrasladoFila[];
}

export interface PesajeBorradorContextType {
  borrador: PesajeBorrador;
  setLoteFilas: Dispatch<SetStateAction<LoteTrasladoFila[]>>;
  /** Datos del aviso "Recuperamos tu borrador…" (null si no se restauró nada). */
  avisoRestauracion: AvisoBorrador | null;
  descartarBorradorRestaurado: () => void;
  /** true mientras un borrador restaurado espera validarse contra los catálogos vigentes
   *  (ids de tara, lote, material, almacén… que pudieron dejar de existir). */
  saneoPendiente: boolean;
  /** Mensaje de lo que se reseteó al validar el borrador restaurado (null si nada). */
  avisoSaneo: string | null;
  /** La pantalla llama esto tras validar el borrador; el mensaje se muestra junto al aviso. */
  finalizarSaneo: (mensaje: string | null) => void;
  cerrarAvisoRestauracion: () => void;
  setTipo: Dispatch<SetStateAction<TipoPesajeBorrador>>;
  setEntidadId: Dispatch<SetStateAction<string>>;
  setAlmacenOrigenId: Dispatch<SetStateAction<string>>;
  setAlmacenDestinoId: Dispatch<SetStateAction<string>>;
  setFecha: Dispatch<SetStateAction<string>>;
  setPesajesGlobales: Dispatch<SetStateAction<PesajeGlobalFila[]>>;
  setPesajeExterior: Dispatch<SetStateAction<boolean>>;
  setDevolucion: Dispatch<SetStateAction<string>>;
  setFotosDevolucion: Dispatch<SetStateAction<FotoMaterial[]>>;
  setMateriales: Dispatch<SetStateAction<MaterialFila[]>>;
  setObservaciones: Dispatch<SetStateAction<string>>;
  setVehiculo: Dispatch<SetStateAction<string>>;
  /** Vuelve el borrador a su estado inicial — se llama tras guardar con éxito. */
  limpiarBorrador: () => void;
}

export const PesajeBorradorContext = createContext<PesajeBorradorContextType | null>(null);

export function usePesajeBorrador(): PesajeBorradorContextType {
  const ctx = useContext(PesajeBorradorContext);
  if (!ctx) throw new Error('usePesajeBorrador debe usarse dentro de PesajeBorradorProvider');
  return ctx;
}
