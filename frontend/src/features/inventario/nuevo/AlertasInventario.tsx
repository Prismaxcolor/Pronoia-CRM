/** Alertas del inventario (Fase 3): lista compacta al final de la pantalla.
 *  Pide GET /api/inventario/pantalla/alertas. Rojo SOLO para alertas reales (severidad 'roja'); cada alerta lleva su palabra
 *  de severidad además del color, el material/lote y un enlace sugerido. Sin alertas: estado vacío positivo con los umbrales.
 *  Se carga con React.lazy: export default. */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { AlertaInventario, AlertasPantalla, SeveridadAlerta } from '@shared/types/inventario-pantalla.js';
import { formatearNumero, type FiltrosPantalla } from '../../../lib/inventario-nuevo';
import { ESTILO_CONTEO_ALERTA, ESTILO_SEVERIDAD, claveParametros, enlaceAlerta, formatearValorAlerta, ordenarAlertas, parametrosPantalla } from '../../../lib/inventario-pantalla';
import { obtenerAlertasPantalla } from '../../../services/inventario-pantalla-service';
import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import Bloque from './Bloque';
import { AvisosMeta, ErrorBloque, SkeletonBloque } from './PantallaComun';
import { useDatosPantalla } from './useDatosPantalla';

export interface AlertasInventarioProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). No se usa: este bloque pide sus propios datos. */
  resumen: ResumenInventario | null;
}

const ICONO: Record<SeveridadAlerta, typeof Info> = { roja: AlertOctagon, amarilla: AlertTriangle, info: Info };

function ExplicacionUmbrales({ c }: { c: AlertasPantalla['configuracion'] }) {
  return (
    <p className="text-xs text-text-secondary">
      Se avisa cuando un material lleva más de <strong>{formatearNumero(c.alertaDiasAmarilla, 0)} días</strong> en inventario (amarillo) o más de{' '}
      <strong>{formatearNumero(c.alertaDiasRoja, 0)} días</strong> (rojo), cuando la merma de una transformación pasa del umbral de{' '}
      <strong>{formatearNumero(c.umbralMermaPct, 0)} %</strong>, y cuando hay kg embalados sin contenedor asignado. Los días son estimados y los umbrales son configurables.
    </p>
  );
}

function ItemAlerta({ a }: { a: AlertaInventario }) {
  const e = ESTILO_SEVERIDAD[a.severidad];
  const Icono = ICONO[a.severidad];
  const enlace = enlaceAlerta(a);
  return (
    <li className={`flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border p-3 ${e.contenedor}`}>
      <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.insignia}`}>
        <Icono size={12} aria-hidden="true" /> {e.etiqueta}
      </span>
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <p className="text-sm text-text-primary">{a.texto}</p>
        <p className="mt-0.5 text-xs text-text-secondary">
          {a.material && <span className="font-medium">{a.material}</span>}
          {a.material && ' · '}
          {formatearValorAlerta(a)}
          {a.umbral !== null && <> (umbral {formatearNumero(a.umbral, 0)}{a.unidad === 'pct' ? ' %' : a.unidad === 'dias' ? ' días' : ' kg'})</>}
        </p>
      </div>
      <Link to={enlace.ruta} className="shrink-0 text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">{enlace.etiqueta} →</Link>
    </li>
  );
}

function AlertasInventario({ filtros }: AlertasInventarioProps) {
  const params = useMemo(() => parametrosPantalla(filtros), [filtros]);
  const { dato, error, actualizando, recargar } = useDatosPantalla<AlertasPantalla>(claveParametros(params), () => obtenerAlertasPantalla(params));
  const alertas = useMemo(() => ordenarAlertas(dato?.alertas ?? []), [dato]);

  return (
    <Bloque titulo="Alertas" queEstasViendo="lo que pide atención: material con muchos días en inventario, merma por encima del umbral y embalado sin contenedor.">
      {!dato && !error && <SkeletonBloque alto="h-32" />}
      {error && !dato && <ErrorBloque mensaje={error} onReintentar={recargar} />}
      {dato && (
        <div className={actualizando ? 'opacity-60 transition-opacity' : ''}>
          <AvisosMeta meta={dato} />
          {error && <p role="alert" className="mb-3 text-xs text-red-700">No se pudo actualizar: {error}</p>}
          {alertas.length === 0 ? (
            <div className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
              <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-brand-900">Todo en orden: no hay alertas ahora</p>
                <div className="mt-1"><ExplicacionUmbrales c={dato.configuracion} /></div>
                {dato.parcial && <p className="mt-1 text-xs text-amber-800">Ojo: una parte de los datos no se pudo leer, así que esta revisión puede estar incompleta.</p>}
              </div>
            </div>
          ) : (
            <>
              <ul className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Resumen de alertas">
                {(['roja', 'amarilla', 'info'] as const).filter(s => dato.conteo[s] > 0).map(s => (
                  <li key={s} className={`rounded-full px-2.5 py-0.5 font-semibold ${ESTILO_CONTEO_ALERTA[s]}`}>{dato.conteo[s]} {ESTILO_SEVERIDAD[s].etiqueta.toLowerCase()}</li>
                ))}
              </ul>
              <ul className="space-y-2">{alertas.map(a => <ItemAlerta key={a.id} a={a} />)}</ul>
              <div className="mt-3"><ExplicacionUmbrales c={dato.configuracion} /></div>
            </>
          )}
        </div>
      )}
    </Bloque>
  );
}

export default AlertasInventario;
