import { useEffect, useState } from 'react';
import { Wallet, ArrowDownLeft, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { obtenerBancas, obtenerMovimientos } from '../../services/banca-service';
import type { Banca, Movimiento } from '@shared/types/index.js';

const TIPO_ICON = {
  ingreso: <ArrowDownLeft size={16} className="text-green-600" />,
  egreso: <ArrowUpRight size={16} className="text-red-600" />,
  transferencia: <ArrowLeftRight size={16} className="text-blue-600" />,
};

function CochinitPage() {
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [bancaSeleccionada, setBancaSeleccionada] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([obtenerBancas(), obtenerMovimientos()])
      .then(([b, m]) => { setBancas(b); setMovimientos(m); })
      .finally(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  const movFiltrados = bancaSeleccionada
    ? movimientos.filter(m => m.bancaOrigenId === bancaSeleccionada || m.bancaDestinoId === bancaSeleccionada)
    : movimientos;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Wallet size={28} className="text-brand-600" />
        <h1 className="text-2xl font-bold text-text-primary">Cochinito</h1>
      </div>

      {/* Bancas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {bancas.map(banca => {
          const activa = bancaSeleccionada === banca.id;
          return (
            <button
              key={banca.id}
              type="button"
              onClick={() => setBancaSeleccionada(activa ? null : banca.id)}
              className={`text-left bg-surface rounded-xl p-6 shadow-sm border-2 transition-all hover:shadow-md ${
                activa ? 'border-brand-500 ring-2 ring-brand-200' : 'border-border'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-3 h-3 rounded-full ${
                  banca.moneda === 'USD' ? 'bg-brand-500' : 'bg-brand-800'
                }`} />
                <h3 className="font-semibold text-text-primary">{banca.nombre}</h3>
              </div>
              <p className="text-text-muted text-xs mb-3">{banca.descripcion}</p>
              <p className="text-2xl font-bold text-brand-600">
                {banca.moneda === 'USD' ? '$' : 'Bs '}{banca.saldo.toLocaleString()}
              </p>
              <p className="text-xs text-text-muted mt-1">{banca.moneda}</p>
            </button>
          );
        })}
      </div>

      {/* Filtro activo */}
      {bancaSeleccionada && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-text-secondary">
            Mostrando movimientos de: <strong>{bancas.find(b => b.id === bancaSeleccionada)?.nombre}</strong>
          </span>
          <button type="button" onClick={() => setBancaSeleccionada(null)} className="text-xs text-brand-600 hover:text-brand-800 underline">
            Ver todos
          </button>
        </div>
      )}

      {/* Movimientos */}
      <h2 className="text-lg font-semibold text-text-primary mb-3">Movimientos</h2>
      <div className="bg-surface rounded-xl shadow-sm border border-border">
        <div className="divide-y divide-border">
          {movFiltrados.map(mov => (
            <div key={mov.id} className="flex items-center gap-4 p-4 hover:bg-surface-hover transition-colors">
              <div className="w-9 h-9 rounded-full bg-surface-alt flex items-center justify-center">
                {TIPO_ICON[mov.tipo]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">{mov.descripcion}</p>
                <p className="text-xs text-text-muted">{mov.fecha} &middot; {mov.referencia}</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${
                  mov.tipo === 'ingreso' ? 'text-green-600' :
                  mov.tipo === 'egreso' ? 'text-red-600' :
                  'text-blue-600'
                }`}>
                  {mov.tipo === 'ingreso' ? '+' : mov.tipo === 'egreso' ? '-' : ''}
                  {mov.moneda === 'USD' ? '$' : 'Bs '}{mov.monto.toLocaleString()}
                </p>
                <p className="text-xs text-text-muted capitalize">{mov.tipo}</p>
              </div>
            </div>
          ))}
        </div>
        {movFiltrados.length === 0 && (
          <p className="p-8 text-center text-text-muted">No hay movimientos{bancaSeleccionada ? ' en esta banca' : ''}</p>
        )}
      </div>
    </div>
  );
}

export default CochinitPage;
