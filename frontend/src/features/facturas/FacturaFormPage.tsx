import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerTickets } from '../../services/ticket-pesaje-service';
import { crearFactura, type TipoFactura } from '../../services/factura-cv-service';
import { obtenerListas, obtenerListaDetalle } from '../../services/lista-precios-service';
import { useToast } from '../../hooks/use-toast-context';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import AvisoBorrador from '../../components/AvisoBorrador';
import { difiereEstado, restaurarFilas } from '../../lib/borrador';
import { intersectarIds } from '../../lib/borrador-vigentes';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import type { Producto, TicketPesaje, ListaPrecios } from '@shared/types/index.js';
import { EncabezadoPagina } from '../../components/ui';
import { FacturaPaso, FacturaResumen } from './factura-formulario-partes';

interface Entidad { id: string; nombre: string; activo: boolean; fotos: string[] }

/** Una línea del formulario (valores como string para los inputs). */
interface LineaFila {
  uid: number;
  productoId: string;
  peso: string;
  precioUnitario: string;
  /** Material y peso bloqueados: vienen del ticket de pesaje. */
  desdeTicket: boolean;
  /** id del material del ticket (detalle), para conservar precios al re-seleccionar. */
  materialId?: string;
  /** Descuento de peso al facturar — merma/tara adicional no
   *  capturada en el pesaje. Se resta del peso antes de calcular el subtotal.
   *  El valor tecleado se interpreta según `descuentoModo` (kg directos o %
   *  del peso de la línea); siempre se envía al backend como kg. */
  descuento: string;
  descuentoModo: 'kg' | 'porcentaje';
}

let UID = 0;
function lineaVacia(): LineaFila {
  return { uid: UID++, productoId: '', peso: '', precioUnitario: '', desdeTicket: false, descuento: '', descuentoModo: 'kg' };
}

interface Props {
  tipo: TipoFactura;
}

function FacturaFormPage({ tipo }: Props) {
  const navigate = useNavigate();
  const toast = useToast();

  const esCompra = tipo === 'compra';
  const labelEntidad = esCompra ? 'Proveedor' : 'Cliente';
  const ruta = esCompra ? '/compras' : '/ventas';
  const titulo = esCompra ? 'Nueva factura de compra' : 'Nueva factura de venta';

  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ticketsPendientes, setTicketsPendientes] = useState<TicketPesaje[]>([]);
  const [listas, setListas] = useState<ListaPrecios[]>([]);

  const [entidadId, setEntidadId] = useState('');
  const [ticketIds, setTicketIds] = useState<string[]>([]);
  const [lineas, setLineas] = useState<LineaFila[]>([lineaVacia()]);
  const [listaSelId, setListaSelId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarSelectorEntidad, setMostrarSelectorEntidad] = useState(false);
  // Validación de un borrador restaurado contra lo vigente (entidad activa, tickets aún pendientes).
  const [entidadesCargadas, setEntidadesCargadas] = useState(false);
  const [ticketsCargadosPara, setTicketsCargadosPara] = useState<string | null>(null);
  const [saneoPendiente, setSaneoPendiente] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);

  // Precios de la lista elegida (productoId → precio/kg). En ref para poder
  // precargar líneas nuevas (de ticket o manuales) sin re-disparar efectos.
  const preciosLista = useRef<Record<string, number>>({});

  useEffect(() => {
    const cargar = (): Promise<Entidad[]> => (esCompra ? obtenerProveedores() : obtenerClientes());
    cargar().then(lista => { setEntidades(lista.filter(e => e.activo)); setEntidadesCargadas(true); });
    obtenerProductos().then(lista => setProductos(lista.filter(p => p.activo)));
    obtenerListas(tipo).then(lista => setListas(lista.filter(l => l.activo)));
  }, [esCompra, tipo]);

  useEffect(() => {
    // El setState del early-return es real, no redundante: limpia la lista de
    // tickets cuando el usuario DESELECCIONA la entidad después de haber
    // elegido una (no solo en el mount, donde ya arranca en []).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!entidadId) { setTicketsPendientes([]); return; }
    obtenerTickets({ soloNoFacturados: true, entidadId, tipo }).then(lista => {
      setTicketsPendientes(lista);
      setTicketsCargadosPara(entidadId);
    });
  }, [entidadId, tipo]);

  /** Los tickets pendientes de la entidad elegida ya se cargaron (hasta entonces no se sabe qué ids siguen vigentes). */
  const ticketsListos = entidadId !== '' && ticketsCargadosPara === entidadId;

  const ticketsSel = useMemo(
    () => ticketsPendientes.filter(t => ticketIds.includes(t.id)),
    [ticketsPendientes, ticketIds]
  );

  // Precio que define la lista elegida para un material (string vacío si no hay).
  const precioDeLista = (productoId: string): string => {
    const p = preciosLista.current[productoId];
    return p != null ? String(p) : '';
  };

  // Al (de)seleccionar tickets, reconstruir las líneas: UNA por material,
  // consolidando el peso de todas las pesadas de ese material entre los
  // tickets elegidos (antes salía una línea por cada pesada individual).
  // Se conservan los precios y descuentos ya escritos (match por productoId); el peso
  // siempre se recalcula desde los tickets, y los materiales nuevos se precargan con el
  // precio de la lista elegida (si hay). Mientras los tickets seleccionados (p. ej. los de un
  // borrador restaurado) no terminan de cargar NO se reconstruye: con 0 tickets resueltos
  // se perderían las líneas, sus precios y descuentos.
  useEffect(() => {
    if (ticketIds.length > 0 && !ticketsListos) return;
    // Reconstruye las líneas fusionando con las anteriores (conserva precios ya
    // escritos a mano) — es una sincronización real con los tickets seleccionados,
    // no una inicialización que se pueda mover a render/useMemo sin perder ese merge.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLineas(prev => {
      const previos = new Map(prev.filter(l => l.productoId).map(l => [l.productoId, l]));
      const porProducto = new Map<string, { uid: number; precioUnitario: string; peso: number; materialId: string; descuento: string; descuentoModo: 'kg' | 'porcentaje' }>();
      for (const t of ticketsSel) {
        for (const m of t.materiales) {
          const productoId = m.productoId ?? '';
          const existente = porProducto.get(productoId);
          if (existente) {
            existente.peso += m.pesoNeto;
          } else {
            const previa = previos.get(productoId);
            porProducto.set(productoId, {
              uid: previa?.uid ?? UID++,
              precioUnitario: previa?.precioUnitario || precioDeLista(productoId),
              peso: m.pesoNeto,
              materialId: m.id,
              descuento: previa?.descuento ?? '',
              descuentoModo: previa?.descuentoModo ?? 'kg',
            });
          }
        }
      }
      const nuevas: LineaFila[] = Array.from(porProducto.entries()).map(([productoId, v]) => ({
        uid: v.uid,
        productoId,
        peso: String(v.peso),
        precioUnitario: v.precioUnitario,
        desdeTicket: true,
        materialId: v.materialId,
        descuento: v.descuento,
        descuentoModo: v.descuentoModo,
      }));
      return nuevas.length > 0 ? nuevas : [lineaVacia()];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketsSel, ticketsListos]);

  // Un borrador restaurado puede traer una entidad desactivada o tickets que ya se facturaron o
  // anularon: se quitan (con aviso) para no armar una factura con ids obsoletos.
  useEffect(() => {
    if (!saneoPendiente || !entidadesCargadas) return;
    // Validación única de lo restaurado contra datos que llegan de forma asíncrona: no se puede derivar en render sin perder la limpieza del estado.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (entidadId === '') { setSaneoPendiente(false); return; }
    if (!entidades.some(e => e.id === entidadId)) {
      setSaneoPendiente(false);
      setEntidadId('');
      setTicketIds([]);
      setLineas([lineaVacia()]);
      setAvisoSaneo(`El ${labelEntidad.toLowerCase()} del borrador ya no está disponible: se quitó junto con sus tickets. Elige uno de nuevo.`);
      return;
    }
    if (!ticketsListos) return;
    setSaneoPendiente(false);
    const { validos, descartados } = intersectarIds(ticketIds, ticketsPendientes.map(t => t.id));
    if (descartados.length === 0) return;
    setTicketIds(validos);
    setAvisoSaneo(
      `${descartados.length === 1 ? 'Un ticket del borrador ya no está' : `${descartados.length} tickets del borrador ya no están`} pendiente de facturar (se facturó o anuló) y se quitó. Revisa las líneas antes de emitir.`
    );
  }, [saneoPendiente, entidadesCargadas, entidades, entidadId, ticketsListos, ticketIds, ticketsPendientes, labelEntidad]);

  // Borrador de la factura: sobrevive a F5. Las líneas se rearman con los tickets al volver a
  // cargarlos (el efecto de arriba conserva precios y descuentos ya escritos por material).
  const estadoBorrador = { entidadId, ticketIds, lineas, listaSelId, descripcion, observaciones };
  const restablecer = () => {
    setEntidadId('');
    setTicketIds([]);
    setLineas([lineaVacia()]);
    setListaSelId('');
    preciosLista.current = {};
    setDescripcion('');
    setObservaciones('');
    setSaneoPendiente(false);
    setAvisoSaneo(null);
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: `factura-${tipo}`,
    version: 1,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, { entidadId: '', ticketIds: [], lineas: [lineaVacia()], listaSelId: '', descripcion: '', observaciones: '' }),
    aplicar: d => {
      setSaneoPendiente(true);
      setEntidadId(d.entidadId ?? '');
      setTicketIds(d.ticketIds ?? []);
      setLineas(restaurarFilas(d.lineas, lineaVacia));
      setListaSelId(d.listaSelId ?? '');
      setDescripcion(d.descripcion ?? '');
      setObservaciones(d.observaciones ?? '');
      // Solo recupera los precios de la lista para líneas futuras; no pisa los ya escritos.
      if (d.listaSelId) {
        void obtenerListaDetalle(d.listaSelId).then(detalle => {
          const mapa: Record<string, number> = {};
          (detalle?.precios ?? []).forEach(p => { mapa[p.productoId] = p.precio; });
          preciosLista.current = mapa;
        });
      }
    },
    restablecer,
  });

  const toggleTicket = (id: string) =>
    setTicketIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const setLinea = (uid: number, campo: keyof LineaFila, valor: string) =>
    setLineas(prev => prev.map(l => (l.uid === uid ? { ...l, [campo]: valor } : l)));

  // Elegir lista global: carga sus precios y autocompleta TODAS las líneas.
  const aplicarLista = async (id: string) => {
    setListaSelId(id);
    if (!id) { preciosLista.current = {}; return; }
    const detalle = await obtenerListaDetalle(id);
    const mapa: Record<string, number> = {};
    (detalle?.precios ?? []).forEach(p => { mapa[p.productoId] = p.precio; });
    preciosLista.current = mapa;
    setLineas(prev => prev.map(l => {
      const precio = mapa[l.productoId];
      return precio != null ? { ...l, precioUnitario: String(precio) } : l;
    }));
  };

  /** Descuento de la línea convertido siempre a kg, sin importar el modo elegido. */
  const descuentoKgLinea = (l: LineaFila): number => {
    const valor = Number(l.descuento) || 0;
    const peso = Number(l.peso) || 0;
    return l.descuentoModo === 'porcentaje' ? (peso * valor) / 100 : valor;
  };
  const pesoFacturableLinea = (l: LineaFila) => Math.max((Number(l.peso) || 0) - descuentoKgLinea(l), 0);
  const subtotalLinea = (l: LineaFila) => pesoFacturableLinea(l) * (Number(l.precioUnitario) || 0);
  const total = useMemo(() => lineas.reduce((acc, l) => acc + subtotalLinea(l), 0), [lineas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!entidadId) { setError(`Elige un ${labelEntidad.toLowerCase()}.`); return; }
    if (ticketIds.length === 0) { setError('Selecciona al menos un ticket de pesaje.'); return; }
    if (lineas.some(l => !l.productoId)) { setError('Selecciona un material en cada fila.'); return; }
    if (lineas.some(l => (Number(l.peso) || 0) <= 0)) { setError('Cada material debe tener un peso mayor a 0.'); return; }
    // El precio puede ser 0 (material sin costo) tanto en compra como en venta.
    const precioMinimoValido = (l: LineaFila) => l.precioUnitario !== '' && Number(l.precioUnitario) >= 0;
    if (lineas.some(l => !precioMinimoValido(l))) {
      setError('Cada material debe tener un precio unitario (puede ser 0).');
      return;
    }

    setGuardando(true);

    const result = await crearFactura(tipo, {
      entidadId,
      ticketIds,
      items: lineas.map(l => ({
        productoId: l.productoId,
        peso: Number(l.peso),
        precioUnitario: Number(l.precioUnitario),
        descuentoKg: descuentoKgLinea(l),
      })),
      descripcion: descripcion.trim() || null,
      observaciones: observaciones.trim() || null,
    });
    setGuardando(false);

    if ('error' in result) { setError(result.error); return; }
    toast.exito(esCompra ? 'Factura de compra emitida.' : 'Factura de venta emitida.');
    borrador.limpiar();
    navigate(`${ruta}/${result.factura.id}`);
  };

  const inputClass = "w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";
  const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Solo la factura de compra muestra el signo de moneda.
  const fmtMoneda = (n: number) => (esCompra ? `$ ${fmt(n)}` : fmt(n));
  const nombreProducto = (id: string) => productos.find(p => p.id === id)?.nombre ?? 'material';

  // Datos del resumen fijo (solo lectura de lo ya calculado arriba; no cambia ninguna lógica).
  const kgFacturables = lineas.reduce((acc, l) => acc + pesoFacturableLinea(l), 0);
  const materialesEnFactura = ticketsSel.length > 0 ? lineas.length : 0;

  return (
    <div className="max-w-6xl">
      <EncabezadoPagina
        titulo={titulo}
        subtitulo={`Elige el ${labelEntidad.toLowerCase()}, marca los tickets de pesaje que vas a facturar y confirma los precios.`}
        migas={[{ etiqueta: esCompra ? 'Compras' : 'Ventas', to: ruta }, { etiqueta: 'Nueva factura' }]}
      />

      <form onSubmit={handleSubmit}>
        <AvisoBorrador formulario="esta factura" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
        {avisoSaneo && <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoSaneo}</p>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-6">
            <FacturaPaso numero={1} titulo={`${labelEntidad} y lista de precios`} ayuda="A quién se le factura y, si quieres, de qué lista salen los precios.">
              <div>
                <label className={labelClass}>{labelEntidad} *</label>
                <button
                  type="button"
                  onClick={() => setMostrarSelectorEntidad(true)}
                  className={`${inputClass} flex items-center justify-between gap-2 text-left`}
                >
                  <span className={entidadId ? 'text-text-primary truncate' : 'text-text-muted'}>
                    {entidades.find(e => e.id === entidadId)?.nombre ?? '— Selecciona —'}
                  </span>
                  <ChevronDown size={14} className="text-text-muted shrink-0" />
                </button>
              </div>

              <div>
                <label className={labelClass}>Lista de precios</label>
                <select value={listaSelId} onChange={e => aplicarLista(e.target.value)} className={inputClass}>
                  <option value="">Seleccionar lista de precios</option>
                  {listas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </select>
                <p className="text-xs text-text-muted mt-1">
                  Autocompleta el precio de cada material según la lista. Puedes editarlo después a mano.
                </p>
              </div>
            </FacturaPaso>

            <FacturaPaso numero={2} titulo="Tickets de pesaje *" ayuda="Marca los pesajes que entran en esta factura; sus materiales y pesos se cargan solos en el paso 3.">
              <div>
                {!entidadId ? (
                  <p className="text-xs text-text-muted">Elige primero un {labelEntidad.toLowerCase()}.</p>
                ) : ticketsPendientes.length === 0 ? (
                  <p className="text-xs text-text-muted">
                    Sin tickets pendientes para este {labelEntidad.toLowerCase()}.{' '}
                    <Link to="/pesaje" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">Registrar un pesaje →</Link>
                  </p>
                ) : (
                  <div className="border border-border rounded-lg divide-y divide-border max-h-72 overflow-y-auto">
                    {ticketsPendientes.map(t => (
                      <label key={t.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-alt transition-colors">
                        <input
                          type="checkbox"
                          checked={ticketIds.includes(t.id)}
                          onChange={() => toggleTicket(t.id)}
                          className="w-4 h-4 accent-brand-600 shrink-0"
                        />
                        <span className="text-sm text-text-primary">
                          <span className="font-medium">{t.codigo}</span>
                          <span className="text-text-muted"> · {t.fecha ?? '—'} · {t.materiales.length === 1 ? (t.materiales[0].nombreProducto ?? 'material') : `${t.materiales.length} materiales`} · {fmt(t.pesoNetoTotal)} kg</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {ticketIds.length > 0 && (
                  <p className="text-xs text-text-muted mt-2">{ticketIds.length} ticket{ticketIds.length === 1 ? '' : 's'} seleccionado{ticketIds.length === 1 ? '' : 's'}.</p>
                )}
              </div>
            </FacturaPaso>

            <FacturaPaso numero={3} titulo={`Materiales y precios ${ticketsSel.length > 0 ? '(de los tickets)' : ''}`.trim()} ayuda="Confirma el precio de cada material y, si hace falta, un descuento de peso por merma o tara.">
              {ticketsSel.length === 0 ? (
                <p className="text-xs text-text-muted">Selecciona uno o más tickets para cargar sus materiales.</p>
              ) : (
                lineas.map((l, idx) => (
                  <div key={l.uid} className="border border-border rounded-lg p-3 space-y-3 bg-surface-alt/40">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-text-secondary">
                        Material {idx + 1}{l.desdeTicket ? ` · ${nombreProducto(l.productoId)}` : ''}
                      </span>
                    </div>

                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                      <div>
                        <label className={labelClass}>Peso (kg) {l.desdeTicket && <span className="text-text-muted">· del ticket</span>}</label>
                        <input type="number" step="0.001" min="0" value={l.peso} onChange={e => setLinea(l.uid, 'peso', e.target.value)} className={inputClass} placeholder="0.00" disabled={l.desdeTicket} />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className={labelClass + ' mb-0'}>Descuento ({l.descuentoModo === 'porcentaje' ? '%' : 'kg'})</label>
                          <div className="flex rounded-md border border-border overflow-hidden text-[11px]">
                            <button
                              type="button"
                              onClick={() => setLinea(l.uid, 'descuentoModo', 'kg')}
                              className={`px-1.5 py-0.5 ${l.descuentoModo === 'kg' ? 'bg-brand-400 text-white' : 'bg-surface-alt text-text-muted'}`}
                            >
                              kg
                            </button>
                            <button
                              type="button"
                              onClick={() => setLinea(l.uid, 'descuentoModo', 'porcentaje')}
                              className={`px-1.5 py-0.5 ${l.descuentoModo === 'porcentaje' ? 'bg-brand-400 text-white' : 'bg-surface-alt text-text-muted'}`}
                            >
                              %
                            </button>
                          </div>
                        </div>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          max={l.descuentoModo === 'porcentaje' ? 100 : undefined}
                          value={l.descuento}
                          onChange={e => setLinea(l.uid, 'descuento', e.target.value)}
                          className={inputClass}
                          placeholder="0.00"
                          title={l.descuentoModo === 'porcentaje' ? 'Porcentaje del peso a descontar al facturar.' : 'Merma o tara adicional (kg) a descontar al facturar.'}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Precio {esCompra ? '($/kg)' : '(kg)'} *</label>
                        <input type="number" step="0.01" min="0" value={l.precioUnitario} onChange={e => setLinea(l.uid, 'precioUnitario', e.target.value)} className={inputClass} placeholder="0.00" />
                      </div>
                    </div>

                    {descuentoKgLinea(l) > 0 && (
                      <p className="text-xs text-text-muted">
                        Descuento: {fmt(descuentoKgLinea(l))} kg · Peso facturable: {fmt(pesoFacturableLinea(l))} kg
                      </p>
                    )}

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-muted">Subtotal</span>
                      <span className="font-semibold text-text-primary">{fmtMoneda(subtotalLinea(l))}</span>
                    </div>
                  </div>
                ))
              )}
            </FacturaPaso>

            <FacturaPaso numero={4} titulo="Notas (opcional)" ayuda="Texto libre que aparece en la factura impresa.">
              <div>
                <label className={labelClass}>Descripción</label>
                <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)} className={inputClass} placeholder="Opcional" />
              </div>
              <div>
                <label className={labelClass}>Observaciones</label>
                <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} className={`${inputClass} resize-none`} rows={2} placeholder="Opcional" />
              </div>
            </FacturaPaso>
          </div>

          <FacturaResumen
            total={fmtMoneda(total)}
            kgFacturables={`${fmt(kgFacturables)} kg`}
            tickets={ticketIds.length}
            materiales={materialesEnFactura}
            error={error}
            guardando={guardando}
            onCancelar={() => { borrador.limpiar(); navigate(ruta); }}
          />
        </div>
      </form>

      {mostrarSelectorEntidad && (
        <SeleccionarEntidadModal
          titulo={`Elegir ${labelEntidad.toLowerCase()}`}
          entidades={entidades}
          onClose={() => setMostrarSelectorEntidad(false)}
          onSeleccionar={id => {
            setEntidadId(id);
            setTicketIds([]);
            setMostrarSelectorEntidad(false);
          }}
        />
      )}
    </div>
  );
}

export default FacturaFormPage;
