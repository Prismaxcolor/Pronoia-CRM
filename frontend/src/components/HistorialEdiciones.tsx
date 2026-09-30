import { useEffect, useState } from 'react';
import {
  obtenerHistorialEdiciones,
  type EntidadAuditable,
  type EntradaAuditoria,
} from '../services/auditoria-service';

interface Props {
  entidadTipo: EntidadAuditable;
  entidadId: string;
}

function fmtFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtValor(v: string | number | boolean | null): string {
  return v === null || v === '' ? '—' : String(v);
}

function Entrada({ entrada }: { entrada: EntradaAuditoria }) {
  const campos = Object.entries(entrada.cambios);
  return (
    <li className="py-2.5 border-b border-border last:border-b-0 print:border-black">
      <p className="text-sm text-text-primary">
        <span className="font-medium">{entrada.usuarioNombre}</span>
        <span className="text-text-muted"> · {fmtFecha(entrada.createdAt)}</span>
        {entrada.autorizadoPorNombre && (
          <span className="text-text-muted"> · autorizado por {entrada.autorizadoPorNombre}</span>
        )}
      </p>
      {campos.length === 0 ? (
        <p className="text-xs text-text-muted mt-1">Sin cambios en los campos registrados.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {campos.map(([campo, { antes, despues }]) => (
            <li key={campo} className="text-xs text-text-secondary">
              <span className="font-medium text-text-primary">{campo}:</span>{' '}
              {fmtValor(antes)} <span aria-hidden="true">→</span> {fmtValor(despues)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Historial de ediciones de un documento (solo lectura). No renderiza nada si
 * el documento nunca fue editado o si el historial no está disponible. Se
 * imprime junto con el documento. Reutilizable para tickets, facturas y
 * transformaciones.
 */
function HistorialEdiciones({ entidadTipo, entidadId }: Props) {
  const [entradas, setEntradas] = useState<EntradaAuditoria[]>([]);

  useEffect(() => {
    let vigente = true;
    obtenerHistorialEdiciones(entidadTipo, entidadId).then(lista => {
      if (vigente) setEntradas(lista);
    });
    return () => { vigente = false; };
  }, [entidadTipo, entidadId]);

  if (entradas.length === 0) return null;

  return (
    <section className="mt-6 break-inside-avoid" aria-label="Historial de ediciones">
      <h2 className="text-sm font-bold text-text-primary mb-1">Historial de ediciones</h2>
      <ul>
        {entradas.map(e => <Entrada key={e.id} entrada={e} />)}
      </ul>
    </section>
  );
}

export default HistorialEdiciones;
