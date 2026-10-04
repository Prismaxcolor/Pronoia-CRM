import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import { obtenerBancas, obtenerMovimientos, archivarBanca, desarchivarBanca } from '../../services/banca-service';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { useConfirm } from '../../hooks/use-confirm-context';
import {
  AlertaItem, BotonAccion, Bloque, EncabezadoPagina, EstadoVacio, FiltrosBarra, SkeletonBloque, SkeletonKpis, useFiltrosUrl,
} from '../../components/ui';
import { hoyLocal, rangoDeAtajo } from '../../lib/rango-fechas';
import {
  SUBTIPOS_EGRESO, TIPOS_MOVIMIENTO, calcularKpis, filtrarMovimientos, movimientosDelPeriodo, saldosPorBanca,
} from '../../lib/cochinito-kpis';
import type { Banca, Movimiento } from '@shared/types/index.js';
import TasaCambioWidget from './TasaCambioWidget';
import CrearMovimientoModal from './CrearMovimientoModal';
import BancaFormModal from './BancaFormModal';
import KpisCochinito from './KpisCochinito';
import SaldosBancas from './SaldosBancas';
import TarjetaBanca from './TarjetaBanca';

// Lo pesado se carga aparte y después de los indicadores.
const BloquesGraficas = lazy(() => import('./BloquesGraficas'));
const TablaMovimientos = lazy(() => import('./TablaMovimientos'));

/** Filtros en la URL. Todos son parámetros nuevos de esta pantalla (no había ninguno). */
const ESQUEMA_FILTROS = {
  campos: {
    tipo: { tipo: 'opcion', opciones: TIPOS_MOVIMIENTO },
    subtipo: { tipo: 'opcion', opciones: SUBTIPOS_EGRESO },
    banca: { tipo: 'texto' },
    q: { tipo: 'texto' },
    desde: { tipo: 'fecha' },
    hasta: { tipo: 'fecha' },
  },
  rangos: [['desde', 'hasta']],
} as const;

const OPCIONES_TIPO = [
  { valor: 'ingreso', etiqueta: 'Ingresos' },
  { valor: 'egreso', etiqueta: 'Egresos' },
  { valor: 'transferencia', etiqueta: 'Transferencias' },
] as const;

const OPCIONES_SUBTIPO = [
  { valor: 'pago', etiqueta: 'Pagos' },
  { valor: 'adelanto', etiqueta: 'Adelantos' },
] as const;

const str = (v: string | boolean | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

function CochinitPage() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA_FILTROS);
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarArchivadas, setMostrarArchivadas] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [modalBanca, setModalBanca] = useState<{ abierto: true; banca: Banca | null } | { abierto: false }>({ abierto: false });
  const [nombres, setNombres] = useState<{ proveedores: Map<string, string>; clientes: Map<string, string> }>({ proveedores: new Map(), clientes: new Map() });

  const puedeCrear = tienePermiso('cochinito', 'crear');
  const puedeEditar = tienePermiso('cochinito', 'editar');
  const puedeArchivar = tienePermiso('cochinito', 'eliminar');
  const puedeVerProveedores = tienePermiso('proveedores', 'ver');
  const puedeVerClientes = tienePermiso('clientes', 'ver');

  const cargar = async () => {
    const [b, m] = await Promise.all([
      obtenerBancas({ incluirArchivadas: mostrarArchivadas }),
      obtenerMovimientos(),
    ]);
    setBancas(b);
    setMovimientos(m);
  };

  // Igual que cargar(), pero sin pasar por una función async con nombre: el
  // linter no puede ver más allá del await y marca el setState de adentro
  // como "síncrono dentro del efecto" aunque no lo sea.
  useEffect(() => {
    Promise.all([
      obtenerBancas({ incluirArchivadas: mostrarArchivadas }),
      obtenerMovimientos(),
    ])
      .then(([b, m]) => { setBancas(b); setMovimientos(m); })
      .finally(() => setCargando(false));
  }, [mostrarArchivadas]);

  // Nombres de proveedores/clientes para la tabla: una sola llamada por tipo y solo con permiso de verlos.
  useEffect(() => {
    let cancelado = false;
    Promise.all([
      puedeVerProveedores ? obtenerProveedores() : Promise.resolve([]),
      puedeVerClientes ? obtenerClientes() : Promise.resolve([]),
    ]).then(([p, c]) => {
      if (cancelado) return;
      setNombres({
        proveedores: new Map(p.map(x => [x.id, x.nombre])),
        clientes: new Map(c.map(x => [x.id, x.nombre])),
      });
    });
    return () => { cancelado = true; };
  }, [puedeVerProveedores, puedeVerClientes]);

  const nombreContraparte = useCallback(
    (m: Movimiento): string | null =>
      (m.proveedorId ? nombres.proveedores.get(m.proveedorId) : m.clienteId ? nombres.clientes.get(m.clienteId) : null) ?? null,
    [nombres],
  );

  // Sin periodo en la URL se muestran los últimos 30 días (igual que /inventario).
  const periodo = useMemo(() => {
    const desde = str(filtros.desde);
    const hasta = str(filtros.hasta);
    return desde && hasta ? { desde, hasta } : rangoDeAtajo('30d', hoyLocal());
  }, [filtros.desde, filtros.hasta]);

  const kpis = useMemo(() => calcularKpis(bancas, movimientos, periodo), [bancas, movimientos, periodo]);
  const movimientosPeriodo = useMemo(() => movimientosDelPeriodo(movimientos, periodo.desde, periodo.hasta), [movimientos, periodo]);
  const saldos = useMemo(() => saldosPorBanca(bancas), [bancas]);
  const hayIngresos = useMemo(() => movimientos.some(m => m.tipo === 'ingreso'), [movimientos]);
  const bancaFiltro = str(filtros.banca);

  const movFiltrados = useMemo(
    () => filtrarMovimientos(
      movimientos,
      { tipo: str(filtros.tipo), subtipo: str(filtros.subtipo), banca: bancaFiltro, q: str(filtros.q), desde: periodo.desde, hasta: periodo.hasta },
      nombreContraparte,
    ),
    [movimientos, filtros.tipo, filtros.subtipo, filtros.q, bancaFiltro, periodo, nombreContraparte],
  );

  const recargarTras = async () => {
    setCargando(true);
    await cargar();
    setCargando(false);
  };

  const onMovimientoCreado = async () => {
    setModalAbierto(false);
    toast.exito('Movimiento registrado.');
    await recargarTras();
  };

  const onBancaGuardada = async (modo: 'crear' | 'editar') => {
    setModalBanca({ abierto: false });
    toast.exito(modo === 'crear' ? 'Banca creada.' : 'Banca actualizada.');
    await recargarTras();
  };

  const handleArchivarBanca = async (banca: Banca) => {
    const ok = await confirmar({
      titulo: `Archivar la banca "${banca.nombre}"`,
      mensaje: 'Podrás restaurarla más adelante. El histórico de movimientos se conserva intacto.',
      confirmarLabel: 'Archivar',
      variante: 'warning',
    });
    if (!ok) return;
    const result = await archivarBanca(banca.id);
    if (!result.ok) {
      toast.errorMsg(result.razon ?? 'No se pudo archivar la banca.');
      return;
    }
    if (bancaFiltro === banca.id) cambiar({ banca: undefined });
    toast.exito(`Banca "${banca.nombre}" archivada.`);
    await recargarTras();
  };

  const handleDesarchivarBanca = async (banca: Banca) => {
    const ok = await desarchivarBanca(banca.id);
    if (!ok) {
      toast.errorMsg('No se pudo restaurar la banca.');
      return;
    }
    toast.exito(`Banca "${banca.nombre}" restaurada.`);
    await recargarTras();
  };

  const abrirNuevaBanca = () => setModalBanca({ abierto: true, banca: null });

  if (cargando) {
    return (
      <div className="max-w-7xl" aria-busy="true">
        <EncabezadoPagina titulo="Wallet" subtitulo="Cargando la tesorería de Pronoia…" />
        <SkeletonBloque alto="h-20" conMargen etiqueta="Cargando filtros" />
        <SkeletonKpis />
        <SkeletonBloque alto="h-56" conMargen etiqueta="Cargando bancas" />
      </div>
    );
  }

  const vacioTabla = movimientos.length === 0
    ? {
        mensaje: 'Aún no hay movimientos registrados',
        descripcion: 'Aquí aparecerán los pagos, adelantos, ingresos y transferencias de las bancas.',
        accion: puedeCrear ? { etiqueta: 'Registrar el primero', onClick: () => setModalAbierto(true) } : undefined,
      }
    : {
        mensaje: 'Ningún movimiento coincide con los filtros',
        descripcion: 'Prueba con el periodo "Todo", otro tipo de movimiento o una búsqueda distinta.',
        accion: { etiqueta: 'Limpiar filtros', onClick: limpiar },
      };

  return (
    <div className="max-w-7xl">
      <EncabezadoPagina
        titulo="Wallet"
        subtitulo={`Tesorería de Pronoia: cuánto hay en cada banca, qué se ha pagado y a cuánto está la tasa de cambio. ${bancas.filter(b => !b.archivada).length} bancas activas.`}
        acciones={puedeCrear ? <BotonAccion icono={<Plus size={16} />} onClick={() => setModalAbierto(true)}>Nuevo movimiento</BotonAccion> : undefined}
      />

      <FiltrosBarra
        rango={{ desde: str(filtros.desde), hasta: str(filtros.hasta), onCambiar: r => cambiar({ desde: r.desde, hasta: r.hasta }) }}
        selectores={[{ id: 'cochinito-tipo', etiqueta: 'Tipo de movimiento', valor: str(filtros.tipo), opciones: OPCIONES_TIPO, onCambiar: v => cambiar({ tipo: v }) }]}
        buscador={{ id: 'cochinito-q', valor: str(filtros.q), onCambiar: v => cambiar({ q: v }), placeholder: 'Descripción, referencia, N° o proveedor…' }}
        avanzados={[
          { id: 'cochinito-banca', etiqueta: 'Banca', valor: bancaFiltro, opciones: bancas.map(b => ({ valor: b.id, etiqueta: b.nombre })), cargando: false, onCambiar: v => cambiar({ banca: v }) },
          { id: 'cochinito-subtipo', etiqueta: 'Pago o adelanto', valor: str(filtros.subtipo), opciones: OPCIONES_SUBTIPO, onCambiar: v => cambiar({ subtipo: v }) },
        ]}
        onLimpiar={limpiar}
      />

      <section aria-label="Indicadores principales">
        <KpisCochinito kpis={kpis} periodo={periodo} />
      </section>

      {kpis.bancasNegativas > 0 && (
        <section aria-label="Alertas" className="mb-8">
          <ul>
            <AlertaItem
              severidad="amarilla"
              texto={`${kpis.bancasNegativas} ${kpis.bancasNegativas === 1 ? 'banca tiene' : 'bancas tienen'} saldo negativo`}
              detalle={hayIngresos
                ? 'En esas bancas ha salido más dinero del que se registró como entrada. Revisa si falta registrar algún ingreso o transferencia.'
                : 'Hasta ahora solo hay egresos registrados: falta registrar los ingresos (o el saldo inicial) para que el saldo refleje la realidad.'}
            />
          </ul>
        </section>
      )}

      <Bloque
        titulo="Bancas"
        queEstasViendo="El saldo actual de cada banca en su propia moneda (lo que ha entrado menos lo que ha salido). Pulsa una banca para ver solo sus movimientos en la tabla de abajo."
        acciones={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-text-secondary">
              <input type="checkbox" checked={mostrarArchivadas} onChange={e => setMostrarArchivadas(e.target.checked)} className="h-4 w-4 accent-brand-600" />
              Ver archivadas
            </label>
            {puedeCrear && <BotonAccion variante="secundario" icono={<Plus size={14} />} onClick={abrirNuevaBanca}>Nueva banca</BotonAccion>}
          </div>
        }
      >
        {bancas.length === 0 ? (
          <EstadoVacio
            icono={<Wallet size={28} />}
            mensaje="Aún no hay bancas registradas"
            descripcion="Una banca es un lugar donde Pronoia guarda dinero: una caja de efectivo, un banco o un exchange."
            accion={puedeCrear ? { etiqueta: 'Crear la primera banca', onClick: abrirNuevaBanca } : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-3">
              {bancas.map(banca => (
                <TarjetaBanca
                  key={banca.id}
                  banca={banca}
                  seleccionada={bancaFiltro === banca.id}
                  onAlternarFiltro={() => cambiar({ banca: bancaFiltro === banca.id ? undefined : banca.id })}
                  onEditar={puedeEditar ? () => setModalBanca({ abierto: true, banca }) : undefined}
                  onArchivar={puedeArchivar ? () => handleArchivarBanca(banca) : undefined}
                  onDesarchivar={puedeArchivar ? () => handleDesarchivarBanca(banca) : undefined}
                />
              ))}
            </div>
            <div className="lg:col-span-2">
              <SaldosBancas saldos={saldos} />
            </div>
          </div>
        )}
      </Bloque>

      <Bloque
        titulo="Tasas de cambio"
        queEstasViendo="Cuántos bolívares (Bs) cuesta hoy 1 USD (tasa oficial BCV y tasa de Binance) y 1 EUR (BCV). Cada tarjeta muestra cuánto cambió en las últimas lecturas, cuándo se actualizó y cuándo se vuelve a consultar."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TasaCambioWidget fuenteKey="bcv" titulo="Tasa BCV" subtitulo="Dólar oficial · Banco Central de Venezuela" monedaOrigen="USD" cacheMs={24 * 60 * 60 * 1000} acento="brand" />
          <TasaCambioWidget fuenteKey="binance" titulo="Tasa Binance" subtitulo="Dólar paralelo · Binance P2P, precio de venta" monedaOrigen="USD" cacheMs={15 * 60 * 1000} acento="binance" />
          <TasaCambioWidget fuenteKey="euro" titulo="Tasa Euro" subtitulo="Euro oficial · Banco Central de Venezuela" monedaOrigen="EUR" cacheMs={24 * 60 * 60 * 1000} acento="euro" />
        </div>
      </Bloque>

      <Suspense fallback={<SkeletonBloque alto="h-64" conMargen etiqueta="Cargando gráficas" />}>
        <BloquesGraficas
          movimientos={movimientosPeriodo}
          puedeCrear={puedeCrear}
          hayIngresosEnHistorial={hayIngresos}
          onRegistrar={() => setModalAbierto(true)}
        />
      </Suspense>

      <Bloque
        titulo="Movimientos"
        queEstasViendo={`Los movimientos con fecha dentro del periodo (${bancaFiltro ? 'solo de la banca elegida, ' : ''}según los filtros de arriba), con su monto en la moneda de la banca y en USD. ${movFiltrados.length} ${movFiltrados.length === 1 ? 'resultado' : 'resultados'}.`}
      >
        <Suspense fallback={<SkeletonBloque alto="h-64" etiqueta="Cargando movimientos" />}>
          <TablaMovimientos filas={movFiltrados} bancas={bancas} nombreContraparte={nombreContraparte} vacio={vacioTabla} />
        </Suspense>
      </Bloque>

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

export default CochinitPage;
