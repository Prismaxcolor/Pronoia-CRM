import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Scale, DollarSign, TrendingUp, Receipt, Printer, Search, X } from 'lucide-react';
import { obtenerMetricasCompras, type MetricaCompraLinea } from '../../services/metricas-service';

type Vista = 'material' | 'proveedor';
type Preset = 7 | 15 | 30 | 60 | 90 | 'custom';

const PRESETS: Exclude<Preset, 'custom'>[] = [7, 15, 30, 60, 90];

function fmtKg(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
function fmtUsd(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function fechaMenosDias(base: string, dias: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}
function diasEntre(desde: string, hasta: string): number {
  const ms = new Date(`${hasta}T00:00:00`).getTime() - new Date(`${desde}T00:00:00`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

interface Agregado {
  id: string;
  nombre: string;
  categoria: string | null;
  kg: number;
  costo: number;
  contraparteCount: number;
  comprasCount: number;
  precioMinKg: number;
  precioMaxKg: number;
}

/** Agrupa líneas por una clave (productoId o proveedorId) sumando kg/costo,
 *  contando facturas distintas y contrapartes distintas (proveedores por
 *  material, o materiales por proveedor), y el rango de precio por kg de
 *  cada línea individual — misma función sirve para las 3 vistas (top-level,
 *  cruce de nivel 2, y ambas direcciones). */
function agregarPor(
  lineas: MetricaCompraLinea[],
  clave: (l: MetricaCompraLinea) => string,
  nombre: (l: MetricaCompraLinea) => string,
  contraparte: (l: MetricaCompraLinea) => string,
  categoria: (l: MetricaCompraLinea) => string | null
): Agregado[] {
  interface Acc { nombre: string; categoria: string | null; kg: number; costo: number; contrapartes: Set<string>; facturas: Set<string>; precioMin: number; precioMax: number }
  const mapa = new Map<string, Acc>();
  for (const l of lineas) {
    const id = clave(l);
    const precioKg = l.kg > 0 ? l.costo / l.kg : 0;
    const ex = mapa.get(id);
    if (ex) {
      ex.kg += l.kg;
      ex.costo += l.costo;
      ex.contrapartes.add(contraparte(l));
      ex.facturas.add(l.facturaId);
      ex.precioMin = Math.min(ex.precioMin, precioKg);
      ex.precioMax = Math.max(ex.precioMax, precioKg);
    } else {
      mapa.set(id, {
        nombre: nombre(l), categoria: categoria(l), kg: l.kg, costo: l.costo,
        contrapartes: new Set([contraparte(l)]), facturas: new Set([l.facturaId]),
        precioMin: precioKg, precioMax: precioKg,
      });
    }
  }
  return Array.from(mapa.entries())
    .map(([id, v]) => ({
      id, nombre: v.nombre, categoria: v.categoria, kg: v.kg, costo: v.costo,
      contraparteCount: v.contrapartes.size, comprasCount: v.facturas.size,
      precioMinKg: v.precioMin, precioMaxKg: v.precioMax,
    }))
    .sort((a, b) => b.kg - a.kg);
}

function porMaterialDe(lineas: MetricaCompraLinea[]): Agregado[] {
  return agregarPor(
    lineas,
    l => l.productoId ?? l.nombreProducto,
    l => l.nombreProducto,
    l => l.proveedorId,
    l => l.tipoMaterialNombre
  );
}
function porProveedorDe(lineas: MetricaCompraLinea[]): Agregado[] {
  return agregarPor(
    lineas,
    l => l.proveedorId,
    l => l.nombreProveedor,
    l => l.productoId ?? l.nombreProducto,
    () => null
  );
}

/** % de cambio vs. el valor anterior. Null si no hay base de comparación. */
function deltaPct(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

function BadgeDelta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const sube = pct >= 0;
  const texto = `${sube ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%`;
  return (
    <span className={`text-xs font-medium ${sube ? 'text-red-600' : 'text-green-600'}`}>
      {texto} vs. período anterior
    </span>
  );
}

/** Fila con barra horizontal proporcional al máximo del grupo — "barra
 *  simple con Tailwind" en vez de una librería de gráficos. */
function FilaBarra({ item, maxKg, rango, etiquetaContraparte, seleccionada, onClick }: {
  item: Agregado;
  maxKg: number;
  rango: number;
  etiquetaContraparte: string;
  seleccionada: boolean;
  onClick: () => void;
}) {
  const costoPromedio = item.kg > 0 ? item.costo / item.kg : 0;
  const anchoPct = maxKg > 0 ? Math.max((item.kg / maxKg) * 100, 3) : 0;
  const esTop3 = rango < 3;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${fmtKg(item.kg)} kg · $${fmtUsd(item.costo)} · promedio $${fmtUsd(costoPromedio)}/kg`}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
        seleccionada ? 'bg-brand-50 border border-brand-300' : 'hover:bg-surface-alt border border-transparent'
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5 min-w-0">
          {esTop3 && <span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />}
          <span className="truncate">{item.nombre}</span>
          {item.categoria && <span className="text-xs text-text-muted font-normal shrink-0">· {item.categoria}</span>}
        </span>
        <div className="flex items-baseline gap-3 shrink-0">
          <span className="text-sm font-semibold text-text-primary">{fmtKg(item.kg)} kg</span>
          <span className="text-sm font-semibold text-brand-700">${fmtUsd(costoPromedio)}<span className="text-xs font-normal text-text-muted">/kg</span></span>
        </div>
      </div>
      <div className="h-2 bg-surface-alt rounded-full overflow-hidden mb-1.5">
        <div className={`h-full rounded-full ${esTop3 ? 'bg-brand-500' : 'bg-brand-300'}`} style={{ width: `${anchoPct}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>{item.comprasCount} compra{item.comprasCount === 1 ? '' : 's'} · {item.contraparteCount} {etiquetaContraparte}{item.contraparteCount === 1 ? '' : 's'}</span>
        {item.precioMaxKg > item.precioMinKg && (
          <span>rango ${fmtUsd(item.precioMinKg)}–${fmtUsd(item.precioMaxKg)}/kg</span>
        )}
      </div>
    </button>
  );
}

/** Redondea hacia arriba a un número "limpio" (1/2/5 × potencia de 10) para
 *  usar como tope de eje — mismo criterio que cualquier librería de gráficos
 *  usaría para los ticks del eje Y. */
function techoLimpio(n: number): number {
  if (n <= 0) return 1;
  const magnitud = 10 ** Math.floor(Math.log10(n));
  const norm = n / magnitud;
  const paso = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return paso * magnitud;
}

/** Formatea una fecha ISO como "19 ago" para las etiquetas del eje X. */
function fmtFechaCorta(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d} ${MESES[m - 1]}`;
}

/** Tendencia de kg comprados por día (o por semana si el rango es largo) —
 *  columnas con líneas de referencia y tooltip propio, sin librería de
 *  gráficos (barras simples con Tailwind, ver dataviz skill: marcas finas,
 *  tope redondeado, etiqueta solo en el pico, tooltip en vez de title). */
function TendenciaChart({ lineas, desde, hasta }: { lineas: MetricaCompraLinea[]; desde: string; hasta: string }) {
  const totalDias = diasEntre(desde, hasta);
  const porSemana = totalDias > 35;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const buckets = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const l of lineas) {
      let clave = l.fecha;
      if (porSemana) {
        const d = new Date(`${l.fecha}T00:00:00`);
        const diaSemana = (d.getDay() + 6) % 7; // lunes=0
        d.setDate(d.getDate() - diaSemana);
        clave = d.toISOString().slice(0, 10);
      }
      mapa.set(clave, (mapa.get(clave) ?? 0) + l.kg);
    }
    return Array.from(mapa.entries())
      .map(([fecha, kg]) => ({ fecha, kg }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [lineas, porSemana]);

  if (buckets.length === 0) return null;
  const maxReal = Math.max(...buckets.map(b => b.kg));
  const techo = techoLimpio(maxReal);
  const idxPico = buckets.reduce((mejor, b, i) => (b.kg > buckets[mejor].kg ? i : mejor), 0);
  const ALTURA_PX = 140;

  return (
    <div className="bg-surface rounded-xl border border-border p-4 mb-6">
      <h2 className="text-sm font-semibold text-text-primary mb-4">
        Tendencia de kilos comprados {porSemana ? '(por semana)' : '(por día)'}
      </h2>
      <div className="flex gap-3">
        {/* Eje Y: 3 referencias redondeadas (0, mitad, techo). */}
        <div className="flex flex-col justify-between text-xs text-text-muted shrink-0 text-right" style={{ height: ALTURA_PX }}>
          <span>{fmtKg(techo)}</span>
          <span>{fmtKg(techo / 2)}</span>
          <span>0</span>
        </div>
        <div className="flex-1 relative">
          {/* Líneas de referencia (hairline, recesivas). */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ height: ALTURA_PX }}>
            <div className="border-t border-border" />
            <div className="border-t border-border" />
            <div className="border-t border-border" />
          </div>
          <div className="flex items-end justify-center gap-1.5" style={{ height: ALTURA_PX }}>
            {buckets.map((b, i) => (
              <div
                key={b.fecha}
                className="relative flex flex-col items-center justify-end h-full"
                style={{ maxWidth: 28, flex: '1 1 0' }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              >
                {hoverIdx === i && (
                  <div className="absolute bottom-full mb-1.5 z-10 px-2 py-1 rounded-md bg-text-primary text-surface text-xs whitespace-nowrap shadow-lg">
                    <span className="font-semibold">{fmtKg(b.kg)} kg</span>
                    <span className="opacity-70"> · {fmtFechaCorta(b.fecha)}</span>
                  </div>
                )}
                {i === idxPico && hoverIdx !== i && (
                  <span className="text-[11px] font-semibold text-text-primary mb-1 whitespace-nowrap">{fmtKg(b.kg)}</span>
                )}
                <div
                  className={`w-full rounded-t-[4px] transition-colors ${hoverIdx === i ? 'bg-brand-600' : i === idxPico ? 'bg-brand-500' : 'bg-brand-300'}`}
                  style={{ height: `${techo > 0 ? Math.max((b.kg / techo) * 100, b.kg > 0 ? 2 : 0) : 0}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-between text-xs text-text-muted mt-2 pl-8">
        <span>{fmtFechaCorta(buckets[0].fecha)}</span>
        {buckets.length > 2 && <span>{fmtFechaCorta(buckets[Math.floor(buckets.length / 2)].fecha)}</span>}
        <span>{fmtFechaCorta(buckets[buckets.length - 1].fecha)}</span>
      </div>
    </div>
  );
}

function MetricasPage() {
  const [lineas, setLineas] = useState<MetricaCompraLinea[]>([]);
  const [lineasAnterior, setLineasAnterior] = useState<MetricaCompraLinea[]>([]);
  const [cargando, setCargando] = useState(true);

  const [preset, setPreset] = useState<Preset>(30);
  const [hasta, setHasta] = useState(hoyISO());
  const [desde, setDesde] = useState(fechaMenosDias(hoyISO(), 29));
  const [mostrarPersonalizado, setMostrarPersonalizado] = useState(false);

  const [vista, setVista] = useState<Vista>('material');
  const [materialSel, setMaterialSel] = useState<string | null>(null);
  const [proveedorSel, setProveedorSel] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    setCargando(true);
    const largo = diasEntre(desde, hasta);
    const haAnterior = fechaMenosDias(desde, 1);
    const deAnterior = fechaMenosDias(haAnterior, largo - 1);
    Promise.all([
      obtenerMetricasCompras(desde, hasta),
      obtenerMetricasCompras(deAnterior, haAnterior),
    ])
      .then(([actual, anterior]) => { setLineas(actual); setLineasAnterior(anterior); })
      .finally(() => setCargando(false));
  }, [desde, hasta]);

  const elegirPreset = (p: Exclude<Preset, 'custom'>) => {
    setPreset(p);
    setMostrarPersonalizado(false);
    const h = hoyISO();
    setHasta(h);
    setDesde(fechaMenosDias(h, p - 1));
  };

  const resumenDe = (ls: MetricaCompraLinea[]) => {
    const kgTotal = ls.reduce((s, l) => s + l.kg, 0);
    const costoTotal = ls.reduce((s, l) => s + l.costo, 0);
    return {
      kgTotal,
      costoTotal,
      costoPromedioKg: kgTotal > 0 ? costoTotal / kgTotal : 0,
      proveedoresCount: new Set(ls.map(l => l.proveedorId)).size,
      materialesCount: new Set(ls.map(l => l.productoId ?? l.nombreProducto)).size,
      comprasCount: new Set(ls.map(l => l.facturaId)).size,
    };
  };
  const resumen = useMemo(() => resumenDe(lineas), [lineas]);
  const resumenAnterior = useMemo(() => resumenDe(lineasAnterior), [lineasAnterior]);

  // Si la compra más vieja del período es más reciente que "desde", el
  // filtro de fecha no tiene nada más viejo que recortar — se lo decimos
  // explícito para que no parezca que las tarjetas/listas no reaccionan al
  // cambiar de período (son iguales porque no hay más historial, no por un bug).
  const fechaMasAntigua = useMemo(
    () => lineas.reduce<string | null>((min, l) => (min === null || l.fecha < min ? l.fecha : min), null),
    [lineas]
  );
  const sinHistorialAnterior = fechaMasAntigua !== null && fechaMasAntigua > desde;

  const porMaterial = useMemo(() => porMaterialDe(lineas), [lineas]);
  const porProveedor = useMemo(() => porProveedorDe(lineas), [lineas]);

  const listaActiva = vista === 'material' ? porMaterial : porProveedor;
  const listaFiltrada = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return listaActiva;
    return listaActiva.filter(item => item.nombre.toLowerCase().includes(q));
  }, [listaActiva, busqueda]);
  const maxKgLista = listaActiva[0]?.kg ?? 0;

  // Nombres de la selección actual (pueden venir de un período donde ya no
  // hay datos — se resuelven contra `lineas` sin filtrar por vista activa).
  const nombreMaterialSel = materialSel != null
    ? lineas.find(l => (l.productoId ?? l.nombreProducto) === materialSel)?.nombreProducto ?? null
    : null;
  const nombreProveedorSel = proveedorSel != null
    ? lineas.find(l => l.proveedorId === proveedorSel)?.nombreProveedor ?? null
    : null;

  // Cruce a nivel de factura: solo cuando ambas dimensiones están elegidas.
  const facturasCruce = useMemo(() => {
    if (!materialSel || !proveedorSel) return null;
    return lineas
      .filter(l => l.proveedorId === proveedorSel && (l.productoId ?? l.nombreProducto) === materialSel)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [lineas, materialSel, proveedorSel]);

  const detalleNivel2 = useMemo(() => {
    if (facturasCruce) return null;
    if (materialSel) {
      const filtradas = lineas.filter(l => (l.productoId ?? l.nombreProducto) === materialSel);
      return { titulo: `Proveedores de "${nombreMaterialSel ?? materialSel}"`, etiqueta: 'material', agregado: porProveedorDe(filtradas), esProveedor: true };
    }
    if (proveedorSel) {
      const filtradas = lineas.filter(l => l.proveedorId === proveedorSel);
      return { titulo: `Materiales de "${nombreProveedorSel ?? proveedorSel}"`, etiqueta: 'proveedor', agregado: porMaterialDe(filtradas), esProveedor: false };
    }
    return null;
  }, [lineas, materialSel, proveedorSel, facturasCruce, nombreMaterialSel, nombreProveedorSel]);

  if (cargando && lineas.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  const stats = [
    {
      label: 'Kilos totales', valor: `${fmtKg(resumen.kgTotal)} kg`, sub: `${fmtKg(resumen.kgTotal / 1000)} t`,
      delta: deltaPct(resumen.kgTotal, resumenAnterior.kgTotal), icon: <Scale size={20} />, color: 'bg-brand-500',
    },
    {
      label: 'Costo total', valor: `$${fmtUsd(resumen.costoTotal)}`, sub: null,
      delta: deltaPct(resumen.costoTotal, resumenAnterior.costoTotal), icon: <DollarSign size={20} />, color: 'bg-tipo-azul',
    },
    {
      label: 'Costo promedio', valor: `$${fmtUsd(resumen.costoPromedioKg)}/kg`, sub: null,
      delta: deltaPct(resumen.costoPromedioKg, resumenAnterior.costoPromedioKg), icon: <TrendingUp size={20} />, color: 'bg-brand-700',
    },
    {
      label: 'Compras', valor: resumen.comprasCount.toString(), sub: `${resumen.proveedoresCount} proveedores · ${resumen.materialesCount} materiales`,
      delta: null, icon: <Receipt size={20} />, color: 'bg-red-500',
    },
  ];

  return (
    <div className="print-documento print:max-w-none">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Métricas de compras</h1>
          <p className="text-sm text-text-secondary mt-1">
            Del {desde} al {hasta} — kilos y costos comprados a proveedores, por material y por proveedor.
          </p>
          {sinHistorialAnterior && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 mt-2 w-fit">
              No hay compras registradas antes del {fmtFechaCorta(fechaMasAntigua!)} — por eso este período coincide con uno más corto.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => window.print()} className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors" title="Imprimir">
            <Printer size={16} />
          </button>
          <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit shrink-0">
            {PRESETS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => elegirPreset(p)}
                className={`px-3 py-1.5 ${preset === p ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}
              >
                {p}d
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setPreset('custom'); setMostrarPersonalizado(true); }}
              className={`px-3 py-1.5 ${preset === 'custom' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}
            >
              Personalizado
            </button>
          </div>
        </div>
      </div>

      {mostrarPersonalizado && (
        <div className="print:hidden flex items-end gap-3 mb-6 bg-surface rounded-xl border border-border p-4 w-fit">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Desde</label>
            <input
              type="date" value={desde} max={hasta}
              onChange={e => { setPreset('custom'); setDesde(e.target.value); }}
              className="px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Hasta</label>
            <input
              type="date" value={hasta} min={desde} max={hoyISO()}
              onChange={e => { setPreset('custom'); setHasta(e.target.value); }}
              className="px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
        </div>
      )}

      {/* El contenido dependiente de datos mantiene el render anterior a
          opacidad reducida mientras recarga (cambio de período) — sin
          spinner ni salto de layout, solo en la primera carga de la página. */}
      <div className={`transition-opacity duration-150 ${cargando ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map(stat => (
          <div key={stat.label} className="bg-surface rounded-xl p-5 shadow-sm border border-border">
            <div className="flex items-center gap-3 mb-3">
              <div className={`${stat.color} text-white p-2 rounded-lg`}>{stat.icon}</div>
              <span className="text-text-secondary text-sm">{stat.label}</span>
            </div>
            <p className="text-2xl font-bold text-text-primary">{stat.valor}</p>
            {stat.sub && <p className="text-xs text-text-muted mt-0.5">{stat.sub}</p>}
            {stat.delta !== null && <div className="mt-1"><BadgeDelta pct={stat.delta} /></div>}
          </div>
        ))}
      </div>

      {lineas.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center text-text-muted">
          No hay compras registradas en este período.
        </div>
      ) : (
        <>
          <TendenciaChart lineas={lineas} desde={desde} hasta={hasta} />

          <div className="flex items-center justify-between flex-wrap gap-3 mb-4 print:hidden">
            <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit">
              <button type="button" onClick={() => setVista('material')} className={`px-4 py-1.5 ${vista === 'material' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                Por material
              </button>
              <button type="button" onClick={() => setVista('proveedor')} className={`px-4 py-1.5 ${vista === 'proveedor' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
                Por proveedor
              </button>
            </div>
            <div className="relative w-full sm:w-64">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                placeholder={vista === 'material' ? 'Buscar material...' : 'Buscar proveedor...'}
                className="w-full pl-9 pr-3 py-1.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
          </div>

          {(materialSel || proveedorSel) && (
            <div className="flex items-center gap-2 flex-wrap mb-4 print:hidden">
              {nombreMaterialSel && (
                <span className="flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-brand-100 text-brand-800 rounded-full text-xs font-medium">
                  {nombreMaterialSel}
                  <button type="button" onClick={() => setMaterialSel(null)} className="hover:bg-brand-200 rounded-full p-0.5"><X size={12} /></button>
                </span>
              )}
              {nombreProveedorSel && (
                <span className="flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-brand-100 text-brand-800 rounded-full text-xs font-medium">
                  {nombreProveedorSel}
                  <button type="button" onClick={() => setProveedorSel(null)} className="hover:bg-brand-200 rounded-full p-0.5"><X size={12} /></button>
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-surface rounded-xl border border-border p-4">
              <h2 className="text-sm font-semibold text-text-primary mb-3">
                {vista === 'material' ? `Materiales (${listaFiltrada.length})` : `Proveedores (${listaFiltrada.length})`}
              </h2>
              <div className="space-y-1 max-h-[32rem] overflow-y-auto">
                {listaFiltrada.length === 0 ? (
                  <p className="text-sm text-text-muted py-6 text-center">Sin resultados para "{busqueda}".</p>
                ) : listaFiltrada.map((item, idx) => (
                  <FilaBarra
                    key={item.id}
                    item={item}
                    maxKg={maxKgLista}
                    rango={idx}
                    etiquetaContraparte={vista === 'material' ? 'proveedor' : 'material'}
                    seleccionada={vista === 'material' ? materialSel === item.id : proveedorSel === item.id}
                    onClick={() => {
                      if (vista === 'material') setMaterialSel(prev => (prev === item.id ? null : item.id));
                      else setProveedorSel(prev => (prev === item.id ? null : item.id));
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Detalle: cruce a nivel de factura si ambas dimensiones están elegidas,
                si no el desglose de la contraparte, si no un placeholder. */}
            <div className="bg-surface rounded-xl border border-border p-4">
              {facturasCruce ? (
                <>
                  <h2 className="text-sm font-semibold text-text-primary mb-3">
                    Compras de "{nombreMaterialSel}" a "{nombreProveedorSel}" ({facturasCruce.length})
                  </h2>
                  <div className="divide-y divide-border">
                    {facturasCruce.map(l => (
                      <Link
                        key={`${l.facturaId}-${l.productoId ?? l.nombreProducto}`}
                        to={`/compras/${l.facturaId}`}
                        className="flex items-center justify-between py-2.5 text-sm hover:bg-surface-alt transition-colors -mx-2 px-2 rounded"
                      >
                        <div>
                          <span className="text-text-primary font-medium">{l.codigoFactura ?? l.facturaId.slice(0, 8)}</span>
                          <span className="text-text-muted"> · {l.fecha}</span>
                        </div>
                        <span className="text-text-primary">{fmtKg(l.kg)} kg · ${fmtUsd(l.costo)}</span>
                      </Link>
                    ))}
                  </div>
                </>
              ) : detalleNivel2 ? (
                <>
                  <h2 className="text-sm font-semibold text-text-primary mb-3">{detalleNivel2.titulo}</h2>
                  {detalleNivel2.agregado.length === 0 ? (
                    <p className="text-sm text-text-muted py-6 text-center">Sin datos en este período.</p>
                  ) : (
                    <div className="space-y-1">
                      {detalleNivel2.agregado.map((item, idx) => (
                        <FilaBarra
                          key={item.id}
                          item={item}
                          maxKg={detalleNivel2.agregado[0]?.kg ?? 0}
                          rango={idx}
                          etiquetaContraparte={detalleNivel2.esProveedor ? 'material' : 'proveedor'}
                          seleccionada={detalleNivel2.esProveedor ? proveedorSel === item.id : materialSel === item.id}
                          onClick={() => {
                            if (detalleNivel2.esProveedor) setProveedorSel(prev => (prev === item.id ? null : item.id));
                            else setMaterialSel(prev => (prev === item.id ? null : item.id));
                          }}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-text-muted h-full flex items-center justify-center py-12 text-center">
                  Selecciona un {vista === 'material' ? 'material' : 'proveedor'} para ver el detalle —
                  luego selecciona también {vista === 'material' ? 'un proveedor' : 'un material'} para llegar hasta las facturas.
                </p>
              )}
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

export default MetricasPage;
