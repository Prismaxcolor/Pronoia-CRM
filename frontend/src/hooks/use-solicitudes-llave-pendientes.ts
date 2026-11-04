import { useEffect, useRef, useState } from 'react';
import { contarSolicitudesPendientes } from '../services/solicitud-llave-service';
import { useToast } from './use-toast-context';

const INTERVALO_MS = 15_000;

/**
 * Para el superadmin: cuenta las solicitudes de llave pendientes (polling cada 15 s, en pausa con la
 * pestaña oculta) y avisa con un Toast cuando llega una nueva. Para el resto devuelve 0 sin consultar.
 */
export function useSolicitudesLlavePendientes(activo: boolean): number {
  const [pendientes, setPendientes] = useState(0);
  const { info } = useToast();
  const infoRef = useRef(info);
  const previo = useRef<number | null>(null);

  useEffect(() => {
    infoRef.current = info;
  }, [info]);

  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    const consultar = async () => {
      if (document.hidden) return;
      const r = await contarSolicitudesPendientes();
      if (cancelado || !r.ok) return;
      const total = r.data.pendientes;
      if (previo.current !== null && total > previo.current) {
        infoRef.current('Nueva solicitud de llave de edición. Revísala en "Solicitudes de llave".');
      }
      previo.current = total;
      setPendientes(total);
    };
    void consultar();
    const id = window.setInterval(() => void consultar(), INTERVALO_MS);
    return () => {
      cancelado = true;
      window.clearInterval(id);
    };
  }, [activo]);

  return activo ? pendientes : 0;
}
