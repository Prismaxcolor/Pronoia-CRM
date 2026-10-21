import type { Dispatch, SetStateAction } from 'react';
import { fotosNuevasDeFiles, revocarFoto, revocarFotos, sinFotoEn } from './fotos-preview';
import { filaVacia, type FotoMaterial, type MaterialFila } from './material-fila';
import { loteTrasladoFilaVacia, type LoteTrasladoFila } from './lote-traslado-fila';
import { pesajeGlobalVacio, type PesajeGlobalFila } from './pesaje-global-fila';

interface Args {
  materiales: MaterialFila[];
  setMateriales: Dispatch<SetStateAction<MaterialFila[]>>;
  fotosDevolucion: FotoMaterial[];
  setFotosDevolucion: Dispatch<SetStateAction<FotoMaterial[]>>;
  pesajesGlobales: PesajeGlobalFila[];
  setPesajesGlobales: Dispatch<SetStateAction<PesajeGlobalFila[]>>;
  loteFilas: LoteTrasladoFila[];
  setLoteFilas: Dispatch<SetStateAction<LoteTrasladoFila[]>>;
}

/** Acciones sobre las filas del formulario "Nuevo pesaje" (materiales, pesadas globales, lotes a
 *  trasladar y fotos de la devolución). Cada foto o fila que se quita libera su vista previa
 *  (URL.createObjectURL) para no acumular memoria. Nunca muta: siempre devuelve copias. */
export function usePesajeFilas(a: Args) {
  const { materiales, setMateriales, fotosDevolucion, setFotosDevolucion, pesajesGlobales, setPesajesGlobales, loteFilas, setLoteFilas } = a;

  // --- Materiales ---
  const setFila = (uid: number, campo: keyof MaterialFila, valor: string) =>
    setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, [campo]: valor } : f)));
  const agregarMaterial = () => setMateriales(prev => [...prev, filaVacia()]);
  const quitarMaterial = (uid: number) => {
    if (materiales.length > 1) revocarFotos(materiales.find(f => f.uid === uid)?.fotos ?? []);
    setMateriales(prev => (prev.length > 1 ? prev.filter(f => f.uid !== uid) : prev));
  };
  // Las vistas previas se crean fuera de la función de actualización: React puede ejecutarla dos veces
  // (modo estricto) y cada ejecución crearía URLs que nadie liberaría.
  const agregarFotosFila = (uid: number, files: File[]) => {
    const nuevas = fotosNuevasDeFiles(files);
    setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, fotos: [...f.fotos, ...nuevas] } : f)));
  };
  const quitarFotoFila = (uid: number, idx: number) => {
    revocarFoto(materiales.find(f => f.uid === uid)?.fotos[idx]);
    setMateriales(prev => prev.map(f => (f.uid === uid ? { ...f, fotos: sinFotoEn(f.fotos, idx) } : f)));
  };

  // --- Devolución ---
  const agregarFotosDevolucion = (files: File[]) => {
    const nuevas = fotosNuevasDeFiles(files);
    setFotosDevolucion(prev => [...prev, ...nuevas]);
  };
  const quitarFotoDevolucion = (idx: number) => {
    revocarFoto(fotosDevolucion[idx]);
    setFotosDevolucion(prev => sinFotoEn(prev, idx));
  };

  // --- Pesajes globales ---
  const agregarPesajeGlobal = () => setPesajesGlobales(prev => [...prev, pesajeGlobalVacio()]);
  const quitarPesajeGlobal = (uid: number) => {
    revocarFotos(pesajesGlobales.find(p => p.uid === uid)?.fotos ?? []);
    setPesajesGlobales(prev => prev.filter(p => p.uid !== uid));
  };
  const setPesajeGlobalCampo = (uid: number, campo: 'peso' | 'tara', valor: string) =>
    setPesajesGlobales(prev => prev.map(p => (p.uid === uid ? { ...p, [campo]: valor } : p)));
  const agregarFotosPesajeGlobal = (uid: number, files: File[]) => {
    const nuevas = fotosNuevasDeFiles(files);
    setPesajesGlobales(prev => prev.map(p => (p.uid === uid ? { ...p, fotos: [...p.fotos, ...nuevas] } : p)));
  };
  const quitarFotoPesajeGlobal = (uid: number, idx: number) => {
    revocarFoto(pesajesGlobales.find(p => p.uid === uid)?.fotos[idx]);
    setPesajesGlobales(prev => prev.map(p => (p.uid === uid ? { ...p, fotos: sinFotoEn(p.fotos, idx) } : p)));
  };

  // --- Lotes a trasladar ---
  const agregarLoteFila = () => setLoteFilas(prev => [...prev, loteTrasladoFilaVacia()]);
  const quitarLoteFila = (uid: number) => {
    revocarFotos(loteFilas.find(f => f.uid === uid)?.fotos ?? []);
    setLoteFilas(prev => prev.filter(f => f.uid !== uid));
  };
  const setLoteFilaCampo = (uid: number, campo: 'loteId' | 'pesoBruto' | 'tara', valor: string) =>
    setLoteFilas(prev => prev.map(f => (f.uid === uid ? { ...f, [campo]: valor } : f)));
  const agregarFotosLoteFila = (uid: number, files: File[]) => {
    const nuevas = fotosNuevasDeFiles(files);
    setLoteFilas(prev => prev.map(f => (f.uid === uid ? { ...f, fotos: [...f.fotos, ...nuevas] } : f)));
  };
  const quitarFotoLoteFila = (uid: number, idx: number) => {
    revocarFoto(loteFilas.find(f => f.uid === uid)?.fotos[idx]);
    setLoteFilas(prev => prev.map(f => (f.uid === uid ? { ...f, fotos: sinFotoEn(f.fotos, idx) } : f)));
  };

  return {
    setFila, agregarMaterial, quitarMaterial, agregarFotosFila, quitarFotoFila,
    agregarFotosDevolucion, quitarFotoDevolucion,
    agregarPesajeGlobal, quitarPesajeGlobal, setPesajeGlobalCampo, agregarFotosPesajeGlobal, quitarFotoPesajeGlobal,
    agregarLoteFila, quitarLoteFila, setLoteFilaCampo, agregarFotosLoteFila, quitarFotoLoteFila,
  };
}
