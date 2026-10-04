import { Boxes, Coins, PackageCheck, Scale } from 'lucide-react';
import { BarraApilada, Bloque, EstadoVacio, GrillaKpis, TarjetaKpi, formatearKg, formatearNumero, formatearUsd, type SegmentoApilado } from '../../components/ui';
import { COLOR_OTROS } from '../../lib/paleta';
import type { KgPorFase, KpisLotes } from '../../lib/almacenes-kpis';

interface Props {
  kpis: KpisLotes;
  /** facturacion:ver. */
  puedeVerValor: boolean;
  puedeConfigurarPrecio: boolean;
  /** Hay datos de embalado (migración de clasificación aplicada). */
  hayEmbalado: boolean;
  lotesExportacion: number;
  lotesTrabajo: number;
}

/** Cuatro indicadores de los lotes. Todo es del estado de HOY: no hay periodo anterior con el cual comparar. */
export function KpisLotesGrilla({ kpis, puedeVerValor, puedeConfigurarPrecio, hayEmbalado, lotesExportacion, lotesTrabajo }: Props) {
  return (
    <GrillaKpis>
      <TarjetaKpi
        titulo="Kg en lotes"
        icono={<Boxes size={16} />}
        ayuda="Todos los kilos que hay hoy en lotes activos (suma de lo que tiene cada lote en todos los almacenes). Los lotes con stock negativo no restan: se avisan aparte."
        valor={formatearKg(kpis.kgTotal)}
        subtitulo={`${formatearNumero(kpis.lotesConStock, 0)} lote${kpis.lotesConStock === 1 ? '' : 's'} con stock de ${formatearNumero(kpis.lotesActivos, 0)} activos`}
        comparacion={null}
      >
        {kpis.lotesNegativos > 0 && (
          <p className="mt-1 text-xs font-medium text-red-700">{formatearNumero(kpis.lotesNegativos, 0)} lote{kpis.lotesNegativos === 1 ? '' : 's'} con stock negativo: revisar</p>
        )}
      </TarjetaKpi>
      <TarjetaKpi
        titulo="Kg embalados (listos)"
        icono={<PackageCheck size={16} />}
        ayuda="Kilos que una persona marcó como embalados y que el stock actual todavía respalda. Un mismo lote puede estar parte embalado y parte en saca sin embalar."
        estado={hayEmbalado ? 'listo' : 'vacio'}
        mensajeVacio="El embalado por kilos aún no está habilitado en este sistema"
        valor={formatearKg(kpis.embaladoKg)}
        subtitulo="marcados como embalados"
        comparacion={null}
      >
        <p className="mt-1 text-xs text-text-muted">{formatearKg(kpis.enSacaKg)} más en saca, sin embalar</p>
      </TarjetaKpi>
      <TarjetaKpi
        titulo="Valor estimado de venta"
        icono={<Coins size={16} />}
        ayuda="Kilos de cada lote por el precio estimado de venta (USD/kg) que un superadmin cargó a mano. Los lotes mezclan materiales y no tienen costo de compra: esta cifra es una proyección de venta, no un costo."
        estado={!puedeVerValor ? 'sinPermiso' : kpis.kgConPrecio === 0 ? 'vacio' : 'listo'}
        mensajeVacio={puedeConfigurarPrecio ? 'Ningún lote tiene precio estimado: cárgalo en el detalle de cada lote' : 'Ningún lote tiene precio estimado todavía'}
        valor={kpis.valorEstimadoUsd != null ? formatearUsd(kpis.valorEstimadoUsd) : undefined}
        subtitulo="de venta estimada · solo lotes con precio"
        comparacion={null}
      >
        {kpis.kgSinPrecio > 0 && <p className="mt-1 text-xs text-text-muted">{formatearKg(kpis.kgSinPrecio)} de lotes sin precio</p>}
      </TarjetaKpi>
      <TarjetaKpi
        titulo="Lotes activos"
        icono={<Scale size={16} />}
        ayuda="Lotes que hoy reciben material. Los de exportación (Lote 1 a 4) son los que se embalan y se venden; los de trabajo interno (por procesar, procesados) se transforman antes."
        valor={formatearNumero(kpis.lotesActivos, 0)}
        subtitulo={`${formatearNumero(lotesExportacion, 0)} de exportación · ${formatearNumero(lotesTrabajo, 0)} de trabajo interno`}
        comparacion={null}
      />
    </GrillaKpis>
  );
}

const COLOR_POR_PROCESAR = '#E69F00';
const COLOR_PROCESADO = '#0072B2';

interface BarraProps {
  /** null = todavía no se sabe la fase (se está leyendo o falló). */
  porFase: KgPorFase | null;
  errorFase: string | null;
  onReintentar: () => void;
}

/** Barra apilada: de qué fase son los kilos en lotes. */
export function BloqueFases({ porFase, errorFase, onReintentar }: BarraProps) {
  const segmentos: SegmentoApilado[] = porFase ? [
    { clave: 'pp', etiqueta: 'Por procesar', valor: porFase.porProcesarKg, color: COLOR_POR_PROCESAR },
    { clave: 'pr', etiqueta: 'Procesado', valor: porFase.procesadoKg, color: COLOR_PROCESADO },
    { clave: 'ex', etiqueta: 'Exportación', valor: porFase.exportacionKg, color: 'var(--color-brand-600)' },
    { clave: 'ot', etiqueta: 'Sin fase / otros', valor: porFase.otrosKg, color: COLOR_OTROS },
  ] : [];
  const total = segmentos.reduce((s, x) => s + x.valor, 0);
  return (
    <Bloque
      titulo="Kilos por fase"
      queEstasViendo="De los kilos que hay hoy en lotes, cuántos están por procesar, ya procesados o ya en un lote de exportación. «Sin fase» es trabajo interno al que aún no se le definió la fase."
    >
      {errorFase ? (
        <EstadoVacio
          mensaje="No se pudo leer la fase de los lotes"
          descripcion={errorFase}
          accion={{ etiqueta: 'Reintentar', onClick: onReintentar }}
        />
      ) : !porFase ? (
        <div className="h-16 animate-pulse rounded-xl bg-surface-hover" role="status" aria-label="Cargando fases" />
      ) : total <= 0 ? (
        <EstadoVacio
          mensaje="Todavía no hay kilos en lotes para repartir por fase"
          descripcion="La barra aparece cuando algún lote recibe material, ya sea por una compra pesada hacia un lote o por una transformación."
          accion={{ etiqueta: 'Ir a Pesaje', to: '/pesaje' }}
        />
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4">
          <BarraApilada segmentos={segmentos} formatoValor={formatearKg} leyenda="fila" alto="h-4" rotulo="Kilos en lotes por fase" />
        </div>
      )}
    </Bloque>
  );
}
