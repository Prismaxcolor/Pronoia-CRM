import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Package, Lock, RefreshCw } from 'lucide-react';
import { EncabezadoPagina, Pestanas, type PestanaDef } from '../../components/ui';
import {
  obtenerInventario,
  type ArticuloInventario,
  type GrupoInventario,
  type FiltrosInventario,
} from '../../services/inventario-service';
import { obtenerTiposMaterial } from '../../services/tipo-material-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerLotes } from '../../services/lote-service';
import { obtenerAlmacenes } from '../../services/almacen-service';
import { obtenerTomasFisicas } from '../../services/toma-fisica-service';
import { obtenerTransformaciones } from '../../services/transformacion-service';
import { usePestanaRecordada } from '../../hooks/use-pestana-recordada';
import Accordion from '../../components/Accordion';
import AlmacenesPanel from './AlmacenesPanel';
import TrasladosPanel from './TrasladosPanel';
import TomaFisicaPanel from './TomaFisicaPanel';
import LotesPanel from '../lotes/LotesPanel';
import type { TipoMaterial, Producto, Lote, Almacen, ComposicionPCBItem, TomaFisicaInventario, Transformacion } from '@shared/types/index.js';

function fmt(n: number): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Columnas de movimientos. Con filtro por almacén (a.desglose presente) se
 *  relacionan compras, ventas, traslados y transformaciones; en la vista
 *  global se mantienen las columnas netas de siempre. */
function CabeceraMovimientos({ detallado }: { detallado: boolean }) {
  const th = 'px-4 py-2 font-medium text-right';
  if (!detallado) {
    return (
      <>
        <th className={th}>Entradas</th>
        <th className={th}>Salidas</th>
        <th className={th}>Transf.</th>
        <th className={th}>Ajuste</th>
      </>
    );
  }
  return (
    <>
      <th className={th} title="Pesajes de compra">Compras</th>
      <th className={th} title="Pesajes de venta">Ventas</th>
      <th className={th} title="Traslados recibidos desde otro almacén">Tras. entra</th>
      <th className={th} title="Traslados enviados a otro almacén">Tras. sale</th>
      <th className={th} title="Material consumido por transformaciones">Transf. consumo</th>
      <th className={th} title="Material producido por transformaciones">Transf. produce</th>
      <th className={th} title="Ajustes de toma física">Ajuste</th>
    </>
  );
}

function CeldasMovimientos({ a, detallado }: { a: ArticuloInventario; detallado: boolean }) {
  const base = 'px-4 py-2.5 text-right text-text-secondary';
  const ajuste = (kg: number) => (
    <td className={`px-4 py-2.5 text-right ${kg !== 0 ? 'font-semibold text-purple-700' : 'text-text-secondary'}`}>
      {kg > 0 ? '+' : ''}{fmt(kg)}
    </td>
  );
  if (!detallado || !a.desglose) {
    return (
      <>
        <td className={base}>{fmt(a.entradas)}</td>
        <td className={base}>{fmt(a.salidas)}</td>
        <td className={base}>{fmt(a.transformaciones)}</td>
        {ajuste(a.ajustes)}
      </>
    );
  }
  const d = a.desglose;
  return (
    <>
      <td className={base}>{fmt(d.compras)}</td>
      <td className={base}>{fmt(d.ventas)}</td>
      <td className={base}>{fmt(d.trasladoEntrada)}</td>
      <td className={base}>{fmt(d.trasladoSalida)}</td>
      <td className={base}>{fmt(d.transfEntrada)}</td>
      <td className={base}>{fmt(d.transfSalida)}</td>
      {ajuste(d.ajustes)}
    </>
  );
}

interface ArticuloConCategoria extends ArticuloInventario { categoria: string }
interface GrupoDestino {
  clave: string;
  label: string;
  totalKg: number;
  articulos: ArticuloConCategoria[];
  composicion?: ComposicionPCBItem[];
  stockLote?: number;
  /** Toma física abierta que bloquea este lote ahora mismo, si hay. */
  tomaFisicaBloqueando?: TomaFisicaInventario;
  /** Kg retirados de este lote por transformaciones PCB creadas pero
   *  todavía sin completar — "en limbo", ya salieron pero no llegaron
   *  a ningún destino todavía. */
  transformacionPendienteKg?: number;
}

/** ¿Esta toma física abierta bloquea este lote ahora mismo? Bloquea si
 *  incluye alguna categoría "con lote" (PCB), y — si se acotó a lotes
 *  específicos al crearla — este lote es uno de ellos. No exige que el
 *  lote ya tenga stock registrado en el almacén de la toma física: eso
 *  excluiría justo los lotes que la toma física busca encontrar (uno que
 *  el sistema cree en 0 pero que en realidad sí tiene material ahí). */
function tomaFisicaBloqueaLote(lote: Lote, t: TomaFisicaInventario, categorias: TipoMaterial[]): boolean {
  if (t.estado !== 'abierta') return false;
  const tieneCategoriaConLote = t.categoriaIds.some(id => categorias.find(c => c.id === id)?.sinLote === false);
  if (!tieneCategoriaConLote) return false;
  return t.loteIds.length === 0 || t.loteIds.includes(lote.id);
}

interface EstadoArticulo {
  tomaFisica?: TomaFisicaInventario;
  transformacionKg?: number;
}

/** Estado de un artículo (producto + destino) en la vista por categoría:
 *  ¿hay una toma física abierta que lo afecte, o una transformación
 *  creada pero sin completar que ya le retiró peso? Para destino "lote"
 *  (PCB) se puede precisar el almacén y el lote exactos. Para destino MPP
 *  (Ferroso/No Ferroso) esta vista general no distingue almacén, así que
 *  el indicativo es "sí hay alguna en curso", sin precisar dónde. */
function estadoArticulo(
  a: ArticuloInventario,
  productos: Producto[],
  lotes: Lote[],
  tomasFisicas: TomaFisicaInventario[],
  transformacionesPendientes: Transformacion[],
  categorias: TipoMaterial[]
): EstadoArticulo {
  const kgDeProducto = (t: Transformacion) =>
    t.entradaDetalle.filter(d => d.productoId === a.productoId).reduce((acc, d) => acc + d.pesoKg, 0);

  if (a.destinoTipo === 'lote' && a.loteId) {
    const lote = lotes.find(l => l.id === a.loteId);
    const tomaFisica = lote ? tomasFisicas.find(t => tomaFisicaBloqueaLote(lote, t, categorias)) : undefined;
    const pendientes = transformacionesPendientes.filter(
      t => t.categoria === 'pcb' && t.loteOrigenId === a.loteId && kgDeProducto(t) > 0
    );
    return {
      tomaFisica,
      transformacionKg: pendientes.length > 0 ? pendientes.reduce((acc, t) => acc + kgDeProducto(t), 0) : undefined,
    };
  }

  const producto = productos.find(p => p.id === a.productoId);
  const tomaFisica = producto?.tipoMaterialId
    ? tomasFisicas.find(t => t.estado === 'abierta' && t.categoriaIds.includes(producto.tipoMaterialId!))
    : undefined;
  const pendientes = transformacionesPendientes.filter(t => t.categoria === 'ferroso_no_ferroso' && kgDeProducto(t) > 0);
  return {
    tomaFisica,
    transformacionKg: pendientes.length > 0 ? pendientes.reduce((acc, t) => acc + kgDeProducto(t), 0) : undefined,
  };
}

/** Regrupa los mismos artículos ya cargados por destino (MPP, lote o "sin
 *  movimiento") en vez de por categoría. Además incluye los lotes activos
 *  que todavía no tienen ningún producto pesado adentro, como grupo vacío —
 *  si no, un lote recién creado desaparece de esta vista hasta su primer pesaje. */
function agruparPorDestino(
  grupos: GrupoInventario[],
  lotes: Lote[],
  tomasFisicas: TomaFisicaInventario[],
  transformaciones: Transformacion[],
  categorias: TipoMaterial[]
): GrupoDestino[] {
  const mapa = new Map<string, GrupoDestino>();
  for (const g of grupos) {
    for (const a of g.articulos) {
      const clave = a.loteId ?? a.destinoTipo;
      if (!mapa.has(clave)) {
        // a.destinoLabel ya viene como "Sin lote" para destinoTipo 'mpp'
        // (ver MPP_LABEL en inventario-service.ts) — Ferroso/No Ferroso
        // está configurado así, nunca va a un lote real, por eso no
        // aparece en /lotes.
        mapa.set(clave, { clave, label: a.destinoLabel, totalKg: 0, articulos: [] });
      }
      const grupo = mapa.get(clave)!;
      grupo.articulos.push({ ...a, categoria: g.nombreCategoria });
      grupo.totalKg += a.stock;
    }
  }
  for (const l of lotes) {
    if (l.activo && !mapa.has(l.id)) {
      mapa.set(l.id, { clave: l.id, label: l.nombre, totalKg: 0, articulos: [] });
    }
  }
  // Adjunta composición, stock real, y estado de bloqueo/transformación
  // pendiente a cada grupo que corresponda a un lote real — los grupos
  // MPP/sin-lote no tienen lote asociado.
  for (const grupo of mapa.values()) {
    const lote = lotes.find(l => l.id === grupo.clave);
    if (!lote) continue;
    grupo.composicion = lote.composicion;
    grupo.stockLote = lote.stockKg;
    grupo.tomaFisicaBloqueando = tomasFisicas.find(t => tomaFisicaBloqueaLote(lote, t, categorias));
    const pendientesDeEsteLote = transformaciones.filter(
      t => t.categoria === 'pcb' && t.estado === 'bruto' && t.loteOrigenId === lote.id
    );
    if (pendientesDeEsteLote.length > 0) {
      grupo.transformacionPendienteKg = pendientesDeEsteLote.reduce((acc, t) => acc + t.pesoNeto, 0);
    }
  }
  return Array.from(mapa.values()).sort((a, b) => a.label.localeCompare(b.label));
}

type Agrupacion = 'categoria' | 'lote';
const PESTANAS = ['inventario', 'almacenes', 'lotes', 'traslados', 'toma-fisica'] as const;
type Pestana = (typeof PESTANAS)[number];

const PESTANAS_DEF: ReadonlyArray<PestanaDef<Pestana>> = [
  { valor: 'inventario', etiqueta: 'Inventario' },
  { valor: 'almacenes', etiqueta: 'Almacenes' },
  { valor: 'lotes', etiqueta: 'Lotes' },
  { valor: 'traslados', etiqueta: 'Traslados' },
  { valor: 'toma-fisica', etiqueta: 'Toma física' },
];

const SUBTITULO_PESTANA: Record<Pestana, string> = {
  inventario: 'Stock por material y destino (sin lote / lote): compras − ventas ± transformaciones. Al filtrar por almacén se suman también los traslados y los ajustes de toma física, y se detalla cada movimiento.',
  almacenes: 'Cuánto material hay en cada galpón, cuánto vale y cuándo se contó por última vez.',
  lotes: 'Los destinos donde se acumula el material pesado: en qué fase está cada lote, cuánto tiene y qué está listo para salir.',
  traslados: 'Material que se mueve entre almacenes: qué salió, qué llegó y qué falta por recepcionar.',
  'toma-fisica': 'Conteo del material con la mano para comparar con el sistema y corregir diferencias.',
};

function InventarioPage() {
  const [pestana, setPestana] = usePestanaRecordada<Pestana>(
    'pronoia:inventario:pestana',
    ['inventario', 'almacenes', 'lotes', 'traslados', 'toma-fisica'],
    'inventario',
  );
  // /inventario-legacy?pestana=lotes abre esa pestaña (la usa el menú "Gestionar" de la pantalla nueva).
  const [searchParams, setSearchParams] = useSearchParams();
  const pestanaUrl = searchParams.get('pestana');
  useEffect(() => {
    const valida = PESTANAS.find(p => p === pestanaUrl);
    if (valida) setPestana(valida);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setPestana cambia en cada render; solo reaccionamos a la URL.
  }, [pestanaUrl]);
  const [grupos, setGrupos] = useState<GrupoInventario[]>([]);
  const [categorias, setCategorias] = useState<TipoMaterial[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [tomasFisicas, setTomasFisicas] = useState<TomaFisicaInventario[]>([]);
  const [transformaciones, setTransformaciones] = useState<Transformacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosInventario>({});
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('categoria');

  const hayDesglose = grupos.some(g => g.articulos.some(a => a.desglose));

  const gruposPorDestino = useMemo(
    () => agruparPorDestino(grupos, lotes, tomasFisicas, transformaciones, categorias),
    [grupos, lotes, tomasFisicas, transformaciones, categorias]
  );

  useEffect(() => {
    obtenerTiposMaterial().then(setCategorias);
    obtenerProductos().then(setProductos);
    obtenerLotes().then(setLotes);
    obtenerAlmacenes().then(setAlmacenes);
    obtenerTomasFisicas().then(lista => setTomasFisicas(lista.filter(t => t.estado === 'abierta')));
    obtenerTransformaciones({ estado: 'bruto' }).then(setTransformaciones);
  }, []);

  useEffect(() => {
    obtenerInventario(filtros).then(setGrupos).finally(() => setCargando(false));
  }, [filtros]);

  const setFiltro = (campo: keyof FiltrosInventario, valor: string) =>
    setFiltros(prev => ({ ...prev, [campo]: valor || undefined }));

  const toggle = (clave: string) =>
    setExpandidos(prev => {
      const n = new Set(prev);
      if (n.has(clave)) n.delete(clave); else n.add(clave);
      return n;
    });

  const inputClass = "px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  const cambiarPestana = (valor: Pestana) => {
    setPestana(valor);
    // La pestaña va en la URL (se comparte y sobrevive a F5); al cambiar se sueltan los filtros de la pestaña anterior.
    setSearchParams(new URLSearchParams({ pestana: valor }), { replace: true });
  };

  return (
    <div className="max-w-7xl">
      <p className="mb-2 text-xs text-text-muted">
        Esta es la pantalla anterior · <Link to="/inventario" className="text-brand-700 underline hover:text-brand-800">Volver a la nueva</Link>
      </p>
      <EncabezadoPagina titulo="Inventario" subtitulo={SUBTITULO_PESTANA[pestana]} />

      <Pestanas pestanas={PESTANAS_DEF} valor={pestana} onCambiar={cambiarPestana} etiquetaAria="Secciones del inventario">
      {pestana === 'almacenes' && <AlmacenesPanel />}
      {pestana === 'lotes' && <LotesPanel />}
      {pestana === 'traslados' && <TrasladosPanel />}
      {pestana === 'toma-fisica' && <TomaFisicaPanel />}

      {pestana === 'inventario' && (
      <>
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Categoría</label>
          <select value={filtros.tipoMaterialId ?? ''} onChange={e => setFiltro('tipoMaterialId', e.target.value)} className={`${inputClass} w-44`}>
            <option value="">Todas</option>
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Artículo</label>
          <select value={filtros.productoId ?? ''} onChange={e => setFiltro('productoId', e.target.value)} className={`${inputClass} w-44`}>
            <option value="">Todos</option>
            {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Almacén</label>
          <select value={filtros.almacenId ?? ''} onChange={e => setFiltro('almacenId', e.target.value)} className={`${inputClass} w-44`}>
            <option value="">Todos</option>
            {almacenes.filter(a => a.activo).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Desde</label>
          <input type="date" value={filtros.desde ?? ''} onChange={e => setFiltro('desde', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">Hasta</label>
          <input type="date" value={filtros.hasta ?? ''} onChange={e => setFiltro('hasta', e.target.value)} className={inputClass} />
        </div>
        {(filtros.tipoMaterialId || filtros.productoId || filtros.almacenId || filtros.desde || filtros.hasta) && (
          <button type="button" onClick={() => setFiltros({})} className="text-xs text-text-muted hover:text-text-primary underline pb-2">
            Limpiar
          </button>
        )}
        <div className="w-full sm:w-auto sm:ml-auto">
          <label className="block text-xs font-medium text-text-secondary mb-1">Agrupar por</label>
          <div className="flex rounded-lg overflow-hidden border border-border text-sm w-fit">
            <button type="button" onClick={() => setAgrupacion('categoria')} className={`px-3 py-2 ${agrupacion === 'categoria' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
              Categoría
            </button>
            <button type="button" onClick={() => setAgrupacion('lote')} className={`px-3 py-2 ${agrupacion === 'lote' ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}>
              Lote
            </button>
          </div>
        </div>
      </div>

      {cargando ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : grupos.length === 0 ? (
        <p className="text-center text-text-muted py-12">No hay materiales para mostrar.</p>
      ) : agrupacion === 'categoria' ? (
        <div className="space-y-2">
          {grupos.map(g => {
            const clave = g.tipoMaterialId ?? '__sin__';
            return (
              <Accordion
                key={clave}
                open={expandidos.has(clave)}
                onToggle={() => toggle(clave)}
                header={
                  <>
                    <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                      <Package size={16} />
                    </div>
                    <span className="font-semibold text-text-primary text-sm flex-1 text-left">{g.nombreCategoria}</span>
                    <span className="text-xs text-text-muted mr-2">{g.articulos.length} art.</span>
                    <span className={`text-base font-bold ${g.totalKg < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                      {fmt(g.totalKg)} kg
                    </span>
                  </>
                }
              >
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-text-muted bg-surface-alt">
                      <th className="px-5 py-2 font-medium">Artículo</th>
                      <th className="px-4 py-2 font-medium">Destino</th>
                      <CabeceraMovimientos detallado={hayDesglose} />
                      <th className="px-5 py-2 font-medium text-right">Stock (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.articulos.map(a => {
                      const estado = estadoArticulo(a, productos, lotes, tomasFisicas, transformaciones, categorias);
                      return (
                      <tr key={`${a.productoId}-${a.loteId ?? 'mpp'}`} className="border-t border-border">
                        <td className="px-5 py-2.5 text-text-primary">
                          <div className="flex items-center gap-1.5">
                            <span>{a.nombre}</span>
                            {estado.tomaFisica && (
                              <span
                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-700 shrink-0"
                                title={`Bloqueado por la toma física ${estado.tomaFisica.codigo}, abierta`}
                              >
                                <Lock size={9} /> {estado.tomaFisica.codigo}
                              </span>
                            )}
                            {estado.transformacionKg != null && (
                              <span
                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-purple-100 text-purple-700 shrink-0"
                                title="Kg retirados por una transformación creada pero todavía sin completar"
                              >
                                <RefreshCw size={9} /> {fmt(estado.transformacionKg)} kg
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${a.destinoTipo === 'lote' ? 'bg-brand-100 text-brand-700' : 'bg-surface-alt text-text-secondary'}`}>
                            {a.destinoLabel}
                          </span>
                        </td>
                        <CeldasMovimientos a={a} detallado={hayDesglose} />
                        <td className={`px-5 py-2.5 text-right font-semibold ${a.stock < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                          {fmt(a.stock)}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              </Accordion>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {gruposPorDestino.map(g => (
            <Accordion
              key={g.clave}
              open={expandidos.has(g.clave)}
              onToggle={() => toggle(g.clave)}
              header={
                <>
                  <div className="w-9 h-9 rounded-lg bg-brand-100 flex items-center justify-center text-brand-700 shrink-0">
                    <Package size={16} />
                  </div>
                  <span className="font-semibold text-text-primary text-sm flex-1 text-left truncate">{g.label}</span>
                  {g.tomaFisicaBloqueando && (
                    <span
                      className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 shrink-0"
                      title={`Bloqueado por la toma física ${g.tomaFisicaBloqueando.codigo}, abierta`}
                    >
                      <Lock size={11} /> Toma física {g.tomaFisicaBloqueando.codigo}
                    </span>
                  )}
                  {g.transformacionPendienteKg != null && (
                    <span
                      className="hidden sm:flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 shrink-0"
                      title="Peso retirado por una transformación PCB creada pero todavía sin completar"
                    >
                      <RefreshCw size={11} /> En transformación: {fmt(g.transformacionPendienteKg)} kg
                    </span>
                  )}
                  <span className="text-xs text-text-muted mr-2">{g.articulos.length} art.</span>
                  <span className={`text-base font-bold ${g.totalKg < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                    {fmt(g.totalKg)} kg
                  </span>
                </>
              }
            >
              {g.composicion && g.composicion.length > 0 && (
                <div className="px-5 pt-3 pb-1 bg-surface-alt border-b border-border">
                  <p className="text-[11px] font-medium text-text-secondary mb-1.5">Composición estimada</p>
                  <div className="flex flex-wrap gap-1 pb-2">
                    {g.composicion.map(c => (
                      <span key={c.item} className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                        {c.item}: {c.porcentaje}% · ~{fmt((g.stockLote ?? g.totalKg) * (c.porcentaje / 100))} kg
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-muted bg-surface-alt">
                    <th className="px-5 py-2 font-medium">Artículo</th>
                    <th className="px-4 py-2 font-medium">Categoría</th>
                    <CabeceraMovimientos detallado={hayDesglose} />
                    <th className="px-5 py-2 font-medium text-right">Stock (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {g.articulos.length === 0 ? (
                    <tr>
                      <td colSpan={hayDesglose ? 10 : 7} className="px-5 py-3 text-text-muted text-xs">
                        Todavía no se pesó ningún artículo hacia este lote.
                      </td>
                    </tr>
                  ) : g.articulos.map(a => (
                    <tr key={a.productoId} className="border-t border-border">
                      <td className="px-5 py-2.5 text-text-primary">{a.nombre}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{a.categoria}</td>
                      <CeldasMovimientos a={a} detallado={hayDesglose} />
                      <td className={`px-5 py-2.5 text-right font-semibold ${a.stock < 0 ? 'text-red-600' : 'text-text-primary'}`}>
                        {fmt(a.stock)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </Accordion>
          ))}
        </div>
      )}
      </>
      )}
      </Pestanas>
    </div>
  );
}

export default InventarioPage;
