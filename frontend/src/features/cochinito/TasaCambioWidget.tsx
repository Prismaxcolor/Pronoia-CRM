import { useEffect, useState } from 'react';
import { TrendingUp, RefreshCw, ArrowRight, AlertTriangle, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { obtenerTasa, obtenerHistorialTasa, type TasaOficial, type FuenteTasaKey } from '../../services/tasa-service';
import { InfoTooltip, Sparkline, SkeletonTarjeta, formatearNumero } from '../../components/ui';

function formatHaceCuanto(fecha: string): string {
  const ms = Date.now() - new Date(fecha).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'hace unos segundos';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? 's' : ''}`;
}

function formatProxima(fecha: string, cacheMs: number): string {
  const ms = cacheMs - (Date.now() - new Date(fecha).getTime());
  if (ms <= 0) return 'pendiente al recargar';
  const h = Math.floor(ms / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `en ${h} h`;
  return `en ${min} min`;
}

/** Tasa en es-VE: mínimo 2 decimales y hasta 4 (sin ceros sobrantes). */
function formatearTasa(tasa: number): string {
  const completo = formatearNumero(tasa, 4);
  return completo.replace(/(,\d\d\d?)0+$/, '$1').replace(/(,\d\d)0$/, '$1');
}

type Acento = 'brand' | 'binance' | 'euro';

interface Props {
  fuenteKey: FuenteTasaKey;
  titulo: string;
  subtitulo: string;
  monedaOrigen: string;
  /** Cada cuánto se refresca contra la API externa (debe coincidir con el
   *  backend) — solo afecta el texto "Próxima sync". */
  cacheMs: number;
  /** Se conserva por compatibilidad: con el estilo del kit todas las tasas usan el color de marca
   *  (el título y la moneda ya las distinguen; el color no debe ser lo único que las diferencie). */
  acento?: Acento;
}

const CLASE_TARJETA = 'flex h-full flex-col rounded-xl border border-border bg-surface p-4';

function TasaCambioWidget({ fuenteKey, titulo, subtitulo, monedaOrigen, cacheMs }: Props) {
  const [tasa, setTasa] = useState<TasaOficial | null>(null);
  const [historial, setHistorial] = useState<TasaOficial[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = async () => {
    const [t, h] = await Promise.all([obtenerTasa(fuenteKey), obtenerHistorialTasa(fuenteKey, 7)]);
    setTasa(t);
    setHistorial(h);
  };

  // Igual que cargar(), pero sin pasar por una función async con nombre: el
  // linter no puede ver más allá del await y marca el setState de adentro
  // como "síncrono dentro del efecto" aunque no lo sea.
  useEffect(() => {
    setCargando(true);
    Promise.all([obtenerTasa(fuenteKey), obtenerHistorialTasa(fuenteKey, 7)])
      .then(([t, h]) => { setTasa(t); setHistorial(h); })
      .finally(() => setCargando(false));
  }, [fuenteKey]);

  const refrescar = async () => {
    setRefrescando(true);
    await cargar();
    setRefrescando(false);
  };

  if (cargando) return <SkeletonTarjeta />;

  if (!tasa) {
    return (
      <div className={CLASE_TARJETA} role="alert">
        <div className="mb-2 flex items-center gap-2 text-amber-800">
          <AlertTriangle size={16} aria-hidden="true" />
          <p className="text-sm font-medium">{titulo}: tasa no disponible</p>
        </div>
        <p className="mb-3 text-xs text-text-secondary">
          No se pudo contactar al servicio de tasas. Verifica que el backend esté corriendo.
        </p>
        <button
          type="button"
          onClick={refrescar}
          className="mt-auto self-start text-sm font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const valoresOrdenados = [...historial].reverse().map(h => h.tasa);
  const cambio = valoresOrdenados.length >= 2
    ? ((valoresOrdenados[valoresOrdenados.length - 1] - valoresOrdenados[0]) / valoresOrdenados[0]) * 100
    : 0;
  const IconoTendencia = cambio > 0 ? ArrowUp : cambio < 0 ? ArrowDown : Minus;
  const textoTendencia = cambio > 0 ? 'subió' : cambio < 0 ? 'bajó' : 'sin cambio';

  return (
    <article className={CLASE_TARJETA}>
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700" aria-hidden="true">
            <TrendingUp size={18} />
          </span>
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-text-primary">
              {titulo}
              <InfoTooltip etiqueta={`Qué significa: ${titulo}`}>
                Cuántos bolívares (Bs) hay que pagar por 1 {monedaOrigen} según esta fuente; el número grande es la última lectura guardada. La mini gráfica muestra hasta las últimas 7 lecturas y el porcentaje compara la primera con la última (por ejemplo, de Bs 40 a Bs 42 es 5 %).
              </InfoTooltip>
            </h3>
            <p className="text-xs leading-tight text-text-secondary">{subtitulo}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refrescar}
          disabled={refrescando}
          className="rounded-md p-2 text-text-secondary hover:bg-surface-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
          title="Refrescar tasa"
          aria-label={`Refrescar ${titulo}`}
        >
          <RefreshCw size={16} className={refrescando ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </header>

      <div className="mb-1 flex items-baseline gap-1.5 text-xs uppercase tracking-wider text-text-secondary">
        <span>{monedaOrigen}</span>
        <ArrowRight size={11} aria-hidden="true" />
        <span>VES</span>
      </div>
      <p className="text-3xl font-bold leading-none tabular-nums text-text-primary">
        Bs {formatearTasa(tasa.tasa)}
      </p>
      <p className="mb-3 mt-1 text-xs text-text-secondary">por 1 {monedaOrigen}</p>

      {valoresOrdenados.length >= 2 && (
        <div className="mb-3">
          <Sparkline valores={valoresOrdenados} etiquetaAria={`${titulo}, últimas ${historial.length} lecturas: ${textoTendencia} ${formatearNumero(Math.abs(cambio), 2)} %`} />
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-text-secondary">Últimas {historial.length} lecturas</span>
            <span className="flex items-center gap-0.5 font-medium text-text-primary">
              <IconoTendencia size={12} aria-hidden="true" /> {formatearNumero(Math.abs(cambio), 2)} %
              <span className="sr-only"> ({textoTendencia})</span>
            </span>
          </div>
        </div>
      )}

      <div className="mt-auto space-y-1 border-t border-border pt-3 text-xs text-text-secondary">
        <div className="flex justify-between">
          <span>Actualizada</span>
          <span className="text-text-primary">{formatHaceCuanto(tasa.fecha)}</span>
        </div>
        <div className="flex justify-between">
          <span>Próxima sync</span>
          <span className="text-text-primary">{formatProxima(tasa.fecha, cacheMs)}</span>
        </div>
        {tasa.stale && (
          <div className="flex items-center gap-1 pt-1 text-amber-800">
            <AlertTriangle size={12} aria-hidden="true" />
            <span>API externa no disponible — mostrando última lectura guardada</span>
          </div>
        )}
      </div>
    </article>
  );
}

export default TasaCambioWidget;
