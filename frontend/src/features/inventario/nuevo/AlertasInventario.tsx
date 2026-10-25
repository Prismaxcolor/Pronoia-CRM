/** Alertas del inventario (Fase 3): lista compacta al final de la pantalla.
 *  Pide GET /api/inventario/pantalla/alertas. Rojo SOLO para alertas reales (severidad 'roja'); cada alerta lleva su palabra
 *  de severidad además del color, el material/lote y un enlace sugerido. Sin alertas: estado vacío positivo con los umbrales.
 *  Se carga con React.lazy: export default. */

import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { AlertaInventario, AlertasPantalla } from '@shared/types/inventario-pantalla.js';
import { formatearNumero, type FiltrosPantalla } from '../../../lib/inventario-nuevo';
import { ESTILO_CONTEO_ALERTA, ESTILO_SEVERIDAD, claveParametros, enlaceAlerta, formatearValorAlerta, ordenarAlertas, parametrosPantalla } from '../../../lib/inventario-pantalla';
import { obtenerAlertasPantalla } from '../../../services/inventario-pantalla-service';
import type { ResumenInventario } from '../../../services/inventario-resumen-service';
import { AlertaItem, Bloque } from '../../../components/ui';
import { AvisosMeta, ErrorBloque, SkeletonBloque } from './PantallaComun';
import { useDatosPantalla } from './useDatosPantalla';

export interface AlertasInventarioProps {
  /** Filtros vigentes de la pantalla (ya validados; vienen de la URL). */
  filtros: FiltrosPantalla;
  /** Resumen cargado (GET /api/inventario/resumen). No se usa: este bloque pide sus propios datos. */
  resumen: ResumenInventario | null;
}

function ExplicacionUmbrales({ c }: { c: AlertasPantalla['configuracion'] }) {
  return (
    <p className="text-xs text-text-secondary">
      Se avisa cuando un material o lote lleva más de <strong>{formatearNumero(c.alertaDiasAmarilla, 0)} días</strong> en inventario (atención, amarillo) o más de{' '}
      <strong>{formatearNumero(c.alertaDiasRoja, 0)} días</strong> (urgente, rojo); cuando la merma de una transformación pasa de{' '}
      <strong>{formatearNumero(c.umbralMermaPct, 0)} %</strong> de lo que entró (urgente si pasa del doble) y es de al menos <strong>{formatearNumero(c.alertaMermaMinKg ?? 0, 0)} kg</strong>; y cuando hay kg embalados sin contenedor asignado. Los días en inventario son un estimado: se cuentan desde la fecha de entrada del material que queda (por defecto, los límites son 60 y 90 días). Los límites se pueden configurar.
    </p>
  );
}

function ItemAlerta({ a }: { a: AlertaInventario }) {
  const enlace = enlaceAlerta(a);
  return (
    <AlertaItem
      severidad={a.severidad}
      texto={a.texto}
      enlace={{ to: enlace.ruta, etiqueta: enlace.etiqueta }}
      detalle={
        <>
          {a.material && <span className="font-medium">{a.material}</span>}
          {a.material && ' · '}
          {formatearValorAlerta(a)}
          {a.umbral !== null && <> (límite {formatearNumero(a.umbral, 0)}{a.unidad === 'pct' ? ' %' : a.unidad === 'dias' ? ' días' : ' kg'})</>}
        </>
      }
    />
  );
}

function AlertasInventario({ filtros }: AlertasInventarioProps) {
  const params = useMemo(() => parametrosPantalla(filtros, { sinValor: true }), [filtros]);
  const { dato, error, actualizando, recargar } = useDatosPantalla<AlertasPantalla>(claveParametros(params), () => obtenerAlertasPantalla(params));
  const alertas = useMemo(() => ordenarAlertas(dato?.alertas ?? []), [dato]);

  return (
    <Bloque titulo="Alertas" queEstasViendo="lo que pide atención: material o lotes con muchos días en inventario (estimado), merma por encima del límite y kg embalados que todavía no tienen contenedor. Rojo significa urgente, amarillo atención y gris solo aviso.">
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
