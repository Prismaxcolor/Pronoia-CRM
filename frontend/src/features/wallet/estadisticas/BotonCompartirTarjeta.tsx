import { useCallback } from 'react';
import CompartirBoton from '../../../components/CompartirBoton';
import { renderizarTarjetaAPng } from './compartir-tarjeta';
import { rotuloImagen, tituloCompartir } from './estadisticas-compartir';

const CLASE_ICONO =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg text-w-texto2 hover:bg-w-grupo hover:text-w-texto disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-w-acento';

interface Props {
  /** Devuelve la tarjeta a fotografiar (estable entre renders). */
  obtenerTarjeta: () => HTMLElement | null;
  titulo: string;
  rotuloPeriodo: string;
}

/** Ícono de compartir de una tarjeta: genera una imagen PNG de ESA tarjeta (con título, período, fecha y marca Pronoia). */
export default function BotonCompartirTarjeta({ obtenerTarjeta, titulo, rotuloPeriodo }: Props) {
  const renderizar = useCallback(async (): Promise<Blob[]> => {
    const el = obtenerTarjeta();
    if (!el) throw new Error('Tarjeta no disponible');
    return [await renderizarTarjetaAPng(el, rotuloImagen(rotuloPeriodo, new Date()))];
  }, [obtenerTarjeta, rotuloPeriodo]);
  return (
    <CompartirBoton
      titulo={tituloCompartir(titulo)}
      renderizarImagenes={renderizar}
      className={CLASE_ICONO}
      soloIcono
      precalentarAlMontar={false}
      etiquetaAria={`Compartir ${titulo} como imagen`}
    />
  );
}
