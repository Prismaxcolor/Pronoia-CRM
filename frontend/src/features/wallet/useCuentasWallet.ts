import { useCallback, useEffect, useState } from 'react';
import type { Banca } from '@shared/types/index.js';
import { obtenerBancasOError } from '../../services/banca-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useOrdenBancas } from '../cochinito/useOrdenBancas';

/**
 * Cuentas activas de la Wallet nueva en el orden personal de cada usuario (el mismo de la Wallet clásica).
 * Con `incluirArchivadas` también trae las archivadas (se marcan con `archivada`).
 * Distingue "no se pudo cargar" de "no hay cuentas": `error` solo es true si la carga falló.
 */
export function useCuentasWallet(incluirArchivadas = false) {
  const { usuario } = useAuth();
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);
  const { ordenadas, mover, restablecer, personalizado } = useOrdenBancas(usuario?.id, bancas);

  useEffect(() => {
    let vigente = true;
    obtenerBancasOError({ incluirArchivadas })
      .then(b => { if (vigente) { setBancas(b); setError(false); } })
      .catch(() => { if (vigente) setError(true); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [intento, incluirArchivadas]);

  const recargar = useCallback(() => { setCargando(true); setIntento(n => n + 1); }, []);

  return { cuentas: ordenadas, cargando, error, recargar, mover, restablecer, ordenPersonalizado: personalizado };
}
