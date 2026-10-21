import { useState } from 'react';

/** Qué ventana de selección está abierta en el formulario "Nuevo pesaje" y sobre qué fila. */
export function usePesajeSelectores() {
  // Fila de material sobre la que se elige material o tara; la de lote se guarda aparte.
  const [filaActivaUid, setFilaActivaUid] = useState<number | null>(null);
  const [filaLoteActivaUid, setFilaLoteActivaUid] = useState<number | null>(null);
  const [mostrarMaterial, setMostrarMaterial] = useState(false);
  const [mostrarTara, setMostrarTara] = useState(false);
  const [mostrarEntidad, setMostrarEntidad] = useState(false);
  const [mostrarLote, setMostrarLote] = useState(false);
  const [mostrarAlmacenOrigen, setMostrarAlmacenOrigen] = useState(false);
  const [mostrarAlmacenDestino, setMostrarAlmacenDestino] = useState(false);

  return {
    filaActivaUid, filaLoteActivaUid,
    mostrarMaterial, mostrarTara, mostrarEntidad, mostrarLote, mostrarAlmacenOrigen, mostrarAlmacenDestino,
    activarFila: setFilaActivaUid,
    abrirMaterial: (uid: number) => { setFilaActivaUid(uid); setMostrarMaterial(true); },
    abrirTara: (uid: number) => { setFilaActivaUid(uid); setMostrarTara(true); },
    abrirLote: (uid: number) => { setFilaLoteActivaUid(uid); setMostrarLote(true); },
    abrirEntidad: () => setMostrarEntidad(true),
    abrirAlmacenOrigen: () => setMostrarAlmacenOrigen(true),
    abrirAlmacenDestino: () => setMostrarAlmacenDestino(true),
    cerrarMaterial: () => setMostrarMaterial(false),
    cerrarTara: () => setMostrarTara(false),
    cerrarEntidad: () => setMostrarEntidad(false),
    cerrarLote: () => setMostrarLote(false),
    cerrarAlmacenOrigen: () => setMostrarAlmacenOrigen(false),
    cerrarAlmacenDestino: () => setMostrarAlmacenDestino(false),
  };
}

export type SelectoresPesaje = ReturnType<typeof usePesajeSelectores>;
