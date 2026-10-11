import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageOpen, Plus, Ship } from 'lucide-react';
import type { ExportacionResumen } from '@shared/types/index.js';
import { BotonAccion, EncabezadoPagina, EstadoVacio, Insignia, SkeletonBloque } from '../../components/ui';
import type { Tono } from '../../lib/paleta';
import { useAuth } from '../../hooks/use-auth-context';
import { obtenerExportaciones } from '../../services/exportaciones-service';
import { formatearFechaDocumento, formatearPeso } from '../../lib/packing-list';
import { ETIQUETA_ESTADO, estadoExportacion, totalesExportacion, type EstadoExportacion } from '../../lib/exportaciones';

const TONO_ESTADO: Readonly<Record<EstadoExportacion, Tono>> = { borrador: 'aviso', valorada: 'info', con_resultado: 'exito' };

const usd = (n: number | null): string => (n === null ? '—' : `USD ${formatearPeso(n)}`);
const diferencia = (n: number | null): string => (n === null ? '—' : `${n > 0 ? '+' : ''}${usd(n)}`);
const colorDiferencia = (n: number | null): string => (n === null || n === 0 ? '' : n > 0 ? 'text-green-700' : 'text-red-600');

function Cifra({ etiqueta, children, className = '' }: { etiqueta: string; children: string; className?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-text-secondary">{etiqueta}</dt>
      <dd className={`text-sm font-medium tabular-nums ${className}`}>{children}</dd>
    </div>
  );
}

function TarjetaExportacion({ e, puedeVerValores }: { e: ExportacionResumen; puedeVerValores: boolean }) {
  const estado = estadoExportacion(e.kgPorLote, e.proyeccion);
  const totales = totalesExportacion(e.kgPorLote, e.proyeccion);
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/exportaciones/${e.packingListId}`} className="font-semibold text-text-primary hover:text-brand-700 hover:underline break-words">
            {e.clienteNombre ?? 'Cliente sin nombre'}
          </Link>
          <p className="mt-0.5 text-xs text-text-secondary">
            <Link to={`/packing-list/${e.packingListId}`} className="inline-flex items-center gap-1 hover:underline">
              <PackageOpen size={13} aria-hidden="true" /> Packing list {e.contenedor}
            </Link>
            {' · '}{formatearFechaDocumento(e.fecha, 'es')}{' · '}{formatearPeso(e.totalNeto)} kg netos
          </p>
        </div>
        {estado && <Insignia tono={TONO_ESTADO[estado]}>{ETIQUETA_ESTADO[estado]}</Insignia>}
      </div>
      {puedeVerValores && (
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Cifra etiqueta="Total estimado">{usd(totales.estimadoUsd)}</Cifra>
          <Cifra etiqueta="Total real">{usd(totales.realUsd)}</Cifra>
          <Cifra etiqueta={totales.parcial ? 'Diferencia (solo lotes con ambos valores)' : 'Diferencia'} className={colorDiferencia(totales.diferenciaUsd)}>
            {diferencia(totales.diferenciaUsd)}
          </Cifra>
        </dl>
      )}
    </li>
  );
}

function ExportacionesPage() {
  const { tienePermiso } = useAuth();
  const [lista, setLista] = useState<ExportacionResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migracionPendiente, setMigracionPendiente] = useState(false);

  const puedeCrear = tienePermiso('despachos', 'crear') || tienePermiso('despachos', 'editar');
  const puedeVerValores = tienePermiso('facturacion', 'ver');

  useEffect(() => {
    obtenerExportaciones().then(r => {
      if ('error' in r) setError(r.error);
      else { setLista(r.exportaciones); setMigracionPendiente(r.migracionPendiente === true); }
      setCargando(false);
    });
  }, []);

  const acciones = puedeCrear
    ? <BotonAccion soloEnLinea icono={<Plus size={16} />} to="/exportaciones/nueva">Nueva exportación</BotonAccion>
    : undefined;

  return (
    <div className="max-w-6xl">
      <EncabezadoPagina titulo="Exportaciones"
        subtitulo="Cada exportación es un packing list con su cliente internacional. Aquí valoras lo que esperas vender y luego comparas con lo realmente obtenido."
        acciones={acciones} />
      {cargando && <SkeletonBloque alto="h-40" etiqueta="Cargando exportaciones" />}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {migracionPendiente && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Aún no se puede vincular un cliente a un packing list: falta activar esa función en la base de datos. Avisa al administrador.
        </p>
      )}
      {!cargando && !error && !migracionPendiente && lista.length === 0 && (
        <EstadoVacio icono={<Ship size={28} />}
          mensaje="Aún no hay exportaciones"
          descripcion="Crea la primera: elige un packing list y el cliente internacional, valora los lotes y luego compara con el resultado real."
          accion={puedeCrear ? { etiqueta: 'Crear la primera exportación', to: '/exportaciones/nueva', soloEnLinea: true } : undefined} />
      )}
      {lista.length > 0 && (
        <ul className="space-y-3">
          {lista.map(e => <TarjetaExportacion key={e.packingListId} e={e} puedeVerValores={puedeVerValores} />)}
        </ul>
      )}
    </div>
  );
}

export default ExportacionesPage;
