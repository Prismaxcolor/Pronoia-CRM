import { useEffect, useState } from 'react';
import { TrendingUp, RefreshCw, ArrowRight, AlertTriangle } from 'lucide-react';
import { obtenerTasaOficial, obtenerHistorialTasas, type TasaOficial } from '../../services/tasa-service';

const HORAS_24_MS = 24 * 60 * 60 * 1000;

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

function formatProxima(fecha: string): string {
  const ms = HORAS_24_MS - (Date.now() - new Date(fecha).getTime());
  if (ms <= 0) return 'pendiente al recargar';
  const h = Math.floor(ms / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `en ${h} h`;
  return `en ${min} min`;
}

interface SparklineProps {
  values: number[];
  color: string;
}

function Sparkline({ values, color }: SparklineProps) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 200;
  const h = 40;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const areaPoints = `0,${h} ${points} ${w},${h}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`w-full h-12 ${color}`} preserveAspectRatio="none">
      <polygon points={areaPoints} fill="currentColor" opacity="0.15" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TasaCambioWidget() {
  const [tasa, setTasa] = useState<TasaOficial | null>(null);
  const [historial, setHistorial] = useState<TasaOficial[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = async () => {
    const [t, h] = await Promise.all([obtenerTasaOficial(), obtenerHistorialTasas(7)]);
    setTasa(t);
    setHistorial(h);
  };

  useEffect(() => {
    cargar().finally(() => setCargando(false));
  }, []);

  const refrescar = async () => {
    setRefrescando(true);
    await cargar();
    setRefrescando(false);
  };

  if (cargando) {
    return (
      <div className="bg-surface rounded-xl p-6 shadow-sm border border-border h-full flex items-center justify-center">
        <div className="w-6 h-6 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!tasa) {
    return (
      <div className="bg-surface rounded-xl p-6 shadow-sm border border-border h-full">
        <div className="flex items-center gap-2 text-amber-600 mb-2">
          <AlertTriangle size={16} />
          <p className="text-sm font-medium">Tasa no disponible</p>
        </div>
        <p className="text-xs text-text-muted mb-3">
          No se pudo contactar al servicio de tasas. Verifica que el backend esté corriendo.
        </p>
        <button
          type="button"
          onClick={refrescar}
          className="text-sm text-brand-600 hover:text-brand-800 underline"
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
  const tendenciaColor = cambio > 0 ? 'text-green-600' : cambio < 0 ? 'text-red-600' : 'text-text-muted';
  const tendenciaIcono = cambio > 0 ? '▲' : cambio < 0 ? '▼' : '–';

  return (
    <div className="bg-surface rounded-xl p-6 shadow-sm border border-border h-full flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
            <TrendingUp size={18} className="text-brand-600" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary text-sm leading-tight">Tasa BCV</h3>
            <p className="text-xs text-text-muted leading-tight">Banco Central de Venezuela</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refrescar}
          disabled={refrescando}
          className="p-1.5 rounded-md text-text-muted hover:text-brand-600 hover:bg-surface-alt transition-colors disabled:opacity-50"
          title="Refrescar tasa"
        >
          <RefreshCw size={16} className={refrescando ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex items-baseline gap-1.5 mb-1 text-text-muted text-xs uppercase tracking-wider">
        <span>USD</span>
        <ArrowRight size={11} />
        <span>VES</span>
      </div>
      <div className="text-3xl font-bold text-text-primary leading-none mb-1">
        Bs. {tasa.tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
      </div>
      <div className="text-xs text-text-muted mb-4">por 1 USD</div>

      {valoresOrdenados.length >= 2 && (
        <div className="mb-4">
          <Sparkline values={valoresOrdenados} color={cambio >= 0 ? 'text-green-500' : 'text-red-500'} />
          <div className="flex justify-between text-xs mt-1">
            <span className="text-text-muted">Últimas {historial.length} lecturas</span>
            <span className={`font-medium ${tendenciaColor}`}>
              {tendenciaIcono} {Math.abs(cambio).toFixed(2)}%
            </span>
          </div>
        </div>
      )}

      <div className="border-t border-border pt-3 mt-auto space-y-1 text-xs text-text-muted">
        <div className="flex justify-between">
          <span>Actualizada</span>
          <span className="text-text-secondary">{formatHaceCuanto(tasa.fecha)}</span>
        </div>
        <div className="flex justify-between">
          <span>Próxima sync</span>
          <span className="text-text-secondary">{formatProxima(tasa.fecha)}</span>
        </div>
        {tasa.stale && (
          <div className="flex items-center gap-1 text-amber-600 pt-1">
            <AlertTriangle size={12} />
            <span>API externa no disponible — mostrando última lectura guardada</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default TasaCambioWidget;
