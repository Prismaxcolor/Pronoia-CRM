import { useEffect, useState } from 'react';
import { DollarSign, Package, ArrowUpDown, TrendingDown } from 'lucide-react';
import { obtenerBancas, obtenerMovimientos } from '../../services/banca-service';
import { obtenerProductos } from '../../services/producto-service';
import type { Banca, Movimiento, Producto } from '@shared/types/index.js';

function DashboardPage() {
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    Promise.all([obtenerBancas(), obtenerMovimientos(), obtenerProductos()])
      .then(([b, m, p]) => { setBancas(b); setMovimientos(m); setProductos(p); })
      .finally(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  const saldoTotalUSD = bancas.filter(b => b.moneda === 'USD').reduce((s, b) => s + b.saldo, 0);
  const saldoTotalVES = bancas.filter(b => b.moneda === 'VES').reduce((s, b) => s + b.saldo, 0);
  const totalEgresos = movimientos.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0);

  const stats = [
    { label: 'Saldo USD', valor: `$${saldoTotalUSD.toLocaleString()}`, icon: <DollarSign size={20} />, color: 'bg-brand-500' },
    { label: 'Saldo VES', valor: `Bs ${saldoTotalVES.toLocaleString()}`, icon: <DollarSign size={20} />, color: 'bg-brand-700' },
    { label: 'Productos', valor: productos.length.toString(), icon: <Package size={20} />, color: 'bg-tipo-azul' },
    { label: 'Total egresos', valor: `$${totalEgresos.toLocaleString()}`, icon: <TrendingDown size={20} />, color: 'bg-red-500' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-primary mb-6">Dashboard</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(stat => (
          <div key={stat.label} className="bg-surface rounded-xl p-5 shadow-sm border border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className={`${stat.color} text-white p-2 rounded-lg`}>{stat.icon}</div>
              <span className="text-text-secondary text-sm">{stat.label}</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">{stat.valor}</p>
          </div>
        ))}
      </div>

      {/* Bancas */}
      <h2 className="text-lg font-semibold text-text-primary mb-3">Bancas</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {bancas.map(banca => (
          <div key={banca.id} className="bg-surface rounded-xl p-5 shadow-sm border border-border">
            <h3 className="font-semibold text-text-primary">{banca.nombre}</h3>
            <p className="text-text-secondary text-xs mb-3">{banca.descripcion}</p>
            <p className="text-xl font-bold text-brand-600">
              {banca.moneda === 'USD' ? '$' : 'Bs '}{banca.saldo.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Ultimos movimientos */}
      <h2 className="text-lg font-semibold text-text-primary mb-3">Ultimos movimientos</h2>
      <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-alt">
              <th className="text-left p-3 font-medium text-text-secondary">Fecha</th>
              <th className="text-left p-3 font-medium text-text-secondary">Tipo</th>
              <th className="text-left p-3 font-medium text-text-secondary">Descripcion</th>
              <th className="text-left p-3 font-medium text-text-secondary">Referencia</th>
              <th className="text-right p-3 font-medium text-text-secondary">Monto</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.slice(0, 10).map(mov => (
              <tr key={mov.id} className="border-b border-border last:border-0 hover:bg-surface-hover transition-colors">
                <td className="p-3 text-text-primary">{mov.fecha}</td>
                <td className="p-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    mov.tipo === 'ingreso' ? 'bg-green-100 text-green-700' :
                    mov.tipo === 'egreso' ? 'bg-red-100 text-red-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    <ArrowUpDown size={12} />
                    {mov.tipo}
                  </span>
                </td>
                <td className="p-3 text-text-primary">{mov.descripcion}</td>
                <td className="p-3 text-text-secondary">{mov.referencia}</td>
                <td className="p-3 text-right font-medium text-text-primary">
                  {mov.moneda === 'USD' ? '$' : 'Bs '}{mov.monto.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {movimientos.length === 0 && (
          <p className="p-6 text-center text-text-muted">No hay movimientos registrados</p>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
