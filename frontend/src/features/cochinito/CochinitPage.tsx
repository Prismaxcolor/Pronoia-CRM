import { useEffect, useMemo, useState } from 'react';
import {
  Wallet, ArrowDownLeft, ArrowUpRight, ArrowLeftRight,
  Plus, TrendingDown, TrendingUp, Coins, Search,
  Building2, Globe, Pencil, Trash2,
} from 'lucide-react';
import { obtenerBancas, obtenerMovimientos, eliminarBanca } from '../../services/banca-service';
import { useAuth } from '../../hooks/use-auth';
import type { Banca, Movimiento, TipoMovimiento, TipoBanca } from '@shared/types/index.js';
import TasaCambioWidget from './TasaCambioWidget';
import CrearMovimientoModal from './CrearMovimientoModal';
import BancaFormModal from './BancaFormModal';

const TIPO_MOV_ICON: Record<TipoMovimiento, React.ReactNode> = {
  ingreso: <ArrowDownLeft size={16} className="text-green-600" />,
  egreso: <ArrowUpRight size={16} className="text-red-600" />,
  transferencia: <ArrowLeftRight size={16} className="text-blue-600" />,
};

const TIPO_BANCA_ICON: Record<TipoBanca, React.ReactNode> = {
  banco_nacional: <Building2 size={14} />,
  banco_internacional: <Globe size={14} />,
  exchange: <Coins size={14} />,
  efectivo: <Wallet size={14} />,
};

const TIPO_BANCA_LABEL: Record<TipoBanca, string> = {
  banco_nacional: 'Nacional',
  banco_internacional: 'Internacional',
  exchange: 'Exchange',
  efectivo: 'Efectivo',
};

type FiltroTipo = 'todos' | TipoMovimiento;

function inicioDelMes(): Date {
  const ahora = new Date();
  return new Date(ahora.getFullYear(), ahora.getMonth(), 1);
}

function CochinitPage() {
  const { tienePermiso } = useAuth();
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [bancaSeleccionada, setBancaSeleccionada] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [modalAbierto, setModalAbierto] = useState(false);
  const [modalBanca, setModalBanca] = useState<{ abierto: true; banca: Banca | null } | { abierto: false }>({ abierto: false });

  const puedeCrear = tienePermiso('cochinito', 'crear');
  const puedeEditar = tienePermiso('cochinito', 'editar');
  const puedeEliminar = tienePermiso('cochinito', 'eliminar');

  const cargar = async () => {
    const [b, m] = await Promise.all([obtenerBancas(), obtenerMovimientos()]);
    setBancas(b);
    setMovimientos(m);
  };

  useEffect(() => {
    cargar().finally(() => setCargando(false));
  }, []);

  const stats = useMemo(() => {
    const saldoUSD = bancas.filter(b => b.moneda === 'USD').reduce((s, b) => s + b.saldo, 0);
    const saldoVES = bancas.filter(b => b.moneda === 'VES').reduce((s, b) => s + b.saldo, 0);
    const desde = inicioDelMes();
    const delMes = movimientos.filter(m => new Date(m.fecha) >= desde);
    const ingresosMes = delMes
      .filter(m => m.tipo === 'ingreso')
      .reduce((s, m) => s + m.monto, 0);
    const egresosMes = delMes
      .filter(m => m.tipo === 'egreso')
      .reduce((s, m) => s + m.monto, 0);
    return { saldoUSD, saldoVES, ingresosMes, egresosMes };
  }, [bancas, movimientos]);

  const movFiltrados = useMemo(() => {
    let lista = movimientos;
    if (bancaSeleccionada) {
      lista = lista.filter(m => m.bancaOrigenId === bancaSeleccionada || m.bancaDestinoId === bancaSeleccionada);
    }
    if (filtroTipo !== 'todos') {
      lista = lista.filter(m => m.tipo === filtroTipo);
    }
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(m =>
        m.descripcion.toLowerCase().includes(q) ||
        m.referencia.toLowerCase().includes(q)
      );
    }
    return lista;
  }, [movimientos, bancaSeleccionada, filtroTipo, busqueda]);

  const onMovimientoCreado = async () => {
    setModalAbierto(false);
    setCargando(true);
    await cargar();
    setCargando(false);
  };

  const onBancaGuardada = async () => {
    setModalBanca({ abierto: false });
    setCargando(true);
    await cargar();
    setCargando(false);
  };

  const handleEliminarBanca = async (banca: Banca) => {
    if (!window.confirm(`¿Eliminar la banca "${banca.nombre}"? Esta acción no se puede deshacer.`)) return;
    const result = await eliminarBanca(banca.id, banca.saldo);
    if (!result.ok) {
      window.alert(result.razon ?? 'No se pudo eliminar la banca.');
      return;
    }
    if (bancaSeleccionada === banca.id) setBancaSeleccionada(null);
    setCargando(true);
    await cargar();
    setCargando(false);
  };

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  const bancaActual = bancas.find(b => b.id === bancaSeleccionada);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
            <Wallet size={22} className="text-brand-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary leading-tight">Cochinito</h1>
            <p className="text-xs text-text-muted">Tesorería de Pronoia · {bancas.length} bancas activas</p>
          </div>
        </div>

        {puedeCrear && (
          <button
            type="button"
            onClick={() => setModalAbierto(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shadow-sm"
          >
            <Plus size={16} />
            Nuevo movimiento
          </button>
        )}
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Saldo USD" valor={`$${stats.saldoUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} icon={<Coins size={18} />} colorBg="bg-brand-500" />
        <StatCard label="Saldo VES" valor={`Bs. ${stats.saldoVES.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`} icon={<Coins size={18} />} colorBg="bg-brand-700" />
        <StatCard label="Ingresos del mes" valor={`+${stats.ingresosMes.toLocaleString()}`} icon={<TrendingUp size={18} />} colorBg="bg-green-500" />
        <StatCard label="Egresos del mes" valor={`-${stats.egresosMes.toLocaleString()}`} icon={<TrendingDown size={18} />} colorBg="bg-red-500" />
      </div>

      {/* Bancas + tasa widget */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Bancas</h2>
            {puedeCrear && (
              <button
                type="button"
                onClick={() => setModalBanca({ abierto: true, banca: null })}
                className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium"
              >
                <Plus size={14} />
                Nueva banca
              </button>
            )}
          </div>

          {bancas.length === 0 ? (
            <div className="bg-surface rounded-xl p-8 border-2 border-dashed border-border text-center">
              <Wallet size={28} className="mx-auto text-text-muted mb-2 opacity-50" />
              <p className="text-text-secondary text-sm mb-3">Aún no hay bancas registradas.</p>
              {puedeCrear && (
                <button
                  type="button"
                  onClick={() => setModalBanca({ abierto: true, banca: null })}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
                >
                  <Plus size={14} />
                  Crear la primera banca
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {bancas.map(banca => {
                const activa = bancaSeleccionada === banca.id;
                return (
                  <div
                    key={banca.id}
                    className={`group relative bg-surface rounded-xl p-5 shadow-sm border-2 transition-all hover:shadow-md ${
                      activa ? 'border-brand-500 ring-2 ring-brand-200' : 'border-border'
                    }`}
                  >
                    {/* Acciones de banca (top-right, hover) */}
                    {(puedeEditar || puedeEliminar) && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {puedeEditar && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setModalBanca({ abierto: true, banca }); }}
                            className="p-1.5 rounded-md bg-surface-alt hover:bg-brand-50 text-text-muted hover:text-brand-600 transition-colors"
                            title="Editar banca"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        {puedeEliminar && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleEliminarBanca(banca); }}
                            className="p-1.5 rounded-md bg-surface-alt hover:bg-red-50 text-text-muted hover:text-red-600 transition-colors"
                            title="Eliminar banca"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Cuerpo clickeable para filtrar */}
                    <button
                      type="button"
                      onClick={() => setBancaSeleccionada(activa ? null : banca.id)}
                      className="text-left w-full"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${banca.moneda === 'USD' ? 'bg-brand-50 text-brand-600' : 'bg-brand-100 text-brand-800'}`}>
                          {TIPO_BANCA_ICON[banca.tipo]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-text-primary text-sm truncate">{banca.nombre}</h3>
                          <p className="text-xs text-text-muted">{TIPO_BANCA_LABEL[banca.tipo]}</p>
                        </div>
                      </div>
                      {banca.descripcion && (
                        <p className="text-text-muted text-xs mb-3 line-clamp-1">{banca.descripcion}</p>
                      )}
                      <p className="text-2xl font-bold text-brand-600 leading-none">
                        {banca.moneda === 'USD' ? '$' : 'Bs '}
                        {banca.saldo.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-xs text-text-muted mt-1.5">{banca.moneda}</p>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <TasaCambioWidget />
        </div>
      </div>

      {/* Tabs + búsqueda */}
      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          <FiltroTab activo={filtroTipo === 'todos'} onClick={() => setFiltroTipo('todos')} label="Todos" />
          <FiltroTab activo={filtroTipo === 'ingreso'} onClick={() => setFiltroTipo('ingreso')} label="Ingresos" />
          <FiltroTab activo={filtroTipo === 'egreso'} onClick={() => setFiltroTipo('egreso')} label="Egresos" />
          <FiltroTab activo={filtroTipo === 'transferencia'} onClick={() => setFiltroTipo('transferencia')} label="Transferencias" />
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar descripción o referencia..."
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
          />
        </div>
      </div>

      {/* Filtro de banca activo */}
      {bancaSeleccionada && (
        <div className="flex items-center gap-2 -mt-3">
          <span className="text-xs text-text-secondary">
            Filtrando por: <strong>{bancaActual?.nombre}</strong>
          </span>
          <button
            type="button"
            onClick={() => setBancaSeleccionada(null)}
            className="text-xs text-brand-600 hover:text-brand-800 underline"
          >
            quitar filtro
          </button>
        </div>
      )}

      {/* Lista de movimientos */}
      <div className="bg-surface rounded-xl shadow-sm border border-border">
        {movFiltrados.length === 0 ? (
          <div className="p-12 text-center">
            <Wallet size={32} className="mx-auto text-text-muted mb-2 opacity-50" />
            <p className="text-text-muted text-sm">
              No hay movimientos
              {bancaSeleccionada ? ' en esta banca' : ''}
              {filtroTipo !== 'todos' ? ` del tipo ${filtroTipo}` : ''}
              {busqueda ? ' que coincidan con la búsqueda' : ''}
            </p>
            {puedeCrear && movimientos.length === 0 && (
              <button
                type="button"
                onClick={() => setModalAbierto(true)}
                className="mt-3 text-sm text-brand-600 hover:text-brand-800 underline"
              >
                Registra el primero
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {movFiltrados.map(mov => {
              const bancaOrigen = bancas.find(b => b.id === mov.bancaOrigenId);
              const bancaDestino = mov.bancaDestinoId ? bancas.find(b => b.id === mov.bancaDestinoId) : null;
              return (
                <div key={mov.id} className="flex items-center gap-4 p-4 hover:bg-surface-hover transition-colors">
                  <div className="w-10 h-10 rounded-full bg-surface-alt flex items-center justify-center shrink-0">
                    {TIPO_MOV_ICON[mov.tipo]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">{mov.descripcion}</p>
                    <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
                      <span>{mov.fecha}</span>
                      {mov.referencia && <><span>·</span><span>{mov.referencia}</span></>}
                      {bancaOrigen && (
                        <>
                          <span>·</span>
                          <span>
                            {bancaOrigen.nombre}
                            {bancaDestino && ` → ${bancaDestino.nombre}`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-bold ${
                      mov.tipo === 'ingreso' ? 'text-green-600' :
                      mov.tipo === 'egreso' ? 'text-red-600' :
                      'text-blue-600'
                    }`}>
                      {mov.tipo === 'ingreso' ? '+' : mov.tipo === 'egreso' ? '-' : ''}
                      {mov.moneda === 'USD' ? '$' : 'Bs '}
                      {mov.monto.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-text-muted capitalize">{mov.tipo}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modales */}
      {modalAbierto && (
        <CrearMovimientoModal
          bancas={bancas}
          onClose={() => setModalAbierto(false)}
          onCreado={onMovimientoCreado}
        />
      )}
      {modalBanca.abierto && (
        <BancaFormModal
          banca={modalBanca.banca}
          onClose={() => setModalBanca({ abierto: false })}
          onGuardado={onBancaGuardada}
        />
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  valor: string;
  icon: React.ReactNode;
  colorBg: string;
}

function StatCard({ label, valor, icon, colorBg }: StatCardProps) {
  return (
    <div className="bg-surface rounded-xl p-4 shadow-sm border border-border">
      <div className="flex items-center gap-2 mb-2">
        <div className={`${colorBg} text-white p-1.5 rounded-md`}>{icon}</div>
        <span className="text-text-secondary text-xs font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-text-primary truncate">{valor}</p>
    </div>
  );
}

interface FiltroTabProps {
  activo: boolean;
  onClick: () => void;
  label: string;
}

function FiltroTab({ activo, onClick, label }: FiltroTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        activo
          ? 'border-brand-600 text-brand-600'
          : 'border-transparent text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );
}

export default CochinitPage;
