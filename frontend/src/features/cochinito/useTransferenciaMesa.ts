import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/use-auth-context';
import { obtenerCambistas } from '../../services/mesa-cambio-service';
import type { CambistaConSaldo } from '@shared/types/mesa-cambio';
import { FORMULARIO_MESA_VACIO, type FormularioMesa } from './transferencia-mesa';

/**
 * Estado del bloque "Con mesa de cambio" del formulario de transferencia. Los cambistas se cargan solo cuando
 * la persona activa la opción, y solo se ofrece si tiene permiso de crear y ver en la mesa de cambio.
 */
export function useTransferenciaMesa() {
  const { tienePermiso } = useAuth();
  const disponible = tienePermiso('mesa_cambio', 'crear') && tienePermiso('mesa_cambio', 'ver');
  const [activa, setActiva] = useState(false);
  const [form, setForm] = useState<FormularioMesa>(FORMULARIO_MESA_VACIO);
  const [cambistas, setCambistas] = useState<CambistaConSaldo[] | null>(null);
  const [errorCambistas, setErrorCambistas] = useState<string | null>(null);

  useEffect(() => {
    if (!activa || cambistas) return;
    let vigente = true;
    obtenerCambistas().then(r => {
      if (!vigente) return;
      if ('error' in r) setErrorCambistas(r.error);
      else { setErrorCambistas(null); setCambistas(r.cambistas.filter(c => c.activo)); }
    });
    return () => { vigente = false; };
  }, [activa, cambistas]);

  const reiniciar = useCallback(() => { setActiva(false); setForm(FORMULARIO_MESA_VACIO); }, []);

  return { disponible, activa, setActiva, form, setForm, cambistas, errorCambistas, reiniciar };
}

export type EstadoTransferenciaMesa = ReturnType<typeof useTransferenciaMesa>;
