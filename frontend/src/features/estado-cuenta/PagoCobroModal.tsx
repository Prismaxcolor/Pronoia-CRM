import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ResultadoCobroMultiple } from '../../services/cobro-service';
import type { AdelantoDisponible } from '../../services/cruce-service';
import type { FacturaCV } from '../../services/factura-cv-service';
import type { EntradaEstadoCuenta, TipoEntidad } from '../../services/estado-cuenta-service';
import { calcularCruce, sugerirMontoCredito, type ItemCruce } from '../../lib/cruce';
import { fotoLocalDeFile, type FotoLocal } from '../../lib/foto-picker';
import { filtrarComprobantes } from '../../lib/comprobante-imagen';
import { fechaRestaurable, recortarSeleccionPago } from '../../lib/borrador-vigentes';
import { hoyNegocio } from '../../lib/fecha-negocio';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import AvisoBorrador from '../../components/AvisoBorrador';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { useCerrarConEscape } from '../../hooks/use-cerrar-con-escape';
import { useIntentoEnvio } from '../../hooks/use-intento-envio';
import { useTasasUsd } from '../cochinito/useTasasUsd';
import { useComisionDisponible } from '../cochinito/useComisionDisponible';
import CategoriaCobroBotones from './CategoriaCobroBotones';
import { useCategoriasCobro } from './useCategoriasCobro';
import AvisoCategoriasCobro from './AvisoCategoriasCobro';
import { categoriasBloqueanCobro, cobroPideCategoria } from './categoria-cobro';
import type { LineaBanca } from './FilaBancaPago';
import { FUENTE_TASA_PAGO_INICIAL, tasaDePago } from './pago-bs-tasa';
import { fmt } from './pago-cobro-formato';
import { bloqueoPorCarga } from './pago-cobro-carga';
import { validarPagoCobro } from './pago-cobro-validacion';
import { enviarPagoCobro, huellaPagoCobro } from './pago-cobro-envio';
import { usePagoCobroDatos } from './usePagoCobroDatos';
import AvisoCargaPago from './AvisoCargaPago';
import ListaFacturasPago from './ListaFacturasPago';
import ListaNotasPago from './ListaNotasPago';
import ListaAdelantosPago from './ListaAdelantosPago';
import ResumenTotalPago from './ResumenTotalPago';
import SeccionBancasPago from './SeccionBancasPago';

interface Props {
  tipoEntidad: TipoEntidad;
  entidadId: string;
  /** Notas de débito pendientes (sin anular, sin pagar) — filtradas por el padre. */
  notasDebitoPendientes: EntradaEstadoCuenta[];
  /** Notas de crédito disponibles (sin anular, sin aplicar) — se pueden usar
   *  como método de pago/cobro: reducen lo que hace falta cubrir con banca. */
  notasCreditoPendientes: EntradaEstadoCuenta[];
  onClose: () => void;
  onRegistrado: (resultado: ResultadoCobroMultiple) => void;
}

const lineaVacia = (id: number): LineaBanca => ({ id, bancaId: '', montoUsd: '', referencia: '' });
const inputClass = 'w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

/** "Registrar pago" (proveedor) / "Registrar cobro" (cliente) — misma
 *  pantalla (Bloque 45), la única diferencia real es el sentido del dinero
 *  (sale de una banca vs entra a una banca) y a qué RPC/tabla apunta. */
function PagoCobroModal({ tipoEntidad, entidadId, notasDebitoPendientes, notasCreditoPendientes, onClose, onRegistrado }: Props) {
  const esProveedor = tipoEntidad === 'proveedor';
  const verbo = esProveedor ? 'pagar' : 'cobrar';
  const etiquetaAccion = esProveedor ? 'Registrar pago' : 'Registrar cobro';
  const etiquetaAdelanto = esProveedor ? 'adelanto' : 'anticipo';
  const tituloId = useId();

  const nextLineaId = useRef(0);
  const [lineasBanca, setLineasBanca] = useState<LineaBanca[]>([]);
  // Si ya hay líneas (borrador restaurado) se conservan; solo se crea la inicial cuando no hay ninguna.
  const iniciarLineas = useCallback(() => {
    setLineasBanca(prev => (prev.length > 0 ? prev : [lineaVacia(nextLineaId.current++)]));
  }, []);
  const datos = usePagoCobroDatos(tipoEntidad, entidadId, iniciarLineas);
  const { bancas, tasa, facturasPendientes, adelantos } = datos;
  // Pago a proveedor en Bs: tasas Binance/BCV (las del Wallet) para elegir con cuál calcular, y comisión bancaria del Wallet.
  const tasasUsd = useTasasUsd(esProveedor);
  const comisionDisponible = useComisionDisponible(esProveedor);
  /** Facturas marcadas → monto (USD, string editable) que se les aplica de este pago.
   *  Por defecto el saldo pendiente completo, pero se puede bajar para un pago parcial. */
  const [montosFactura, setMontosFactura] = useState<Record<string, string>>({});
  const [notaIdsSel, setNotaIdsSel] = useState<string[]>([]);
  const [notaCreditoIdsSel, setNotaCreditoIdsSel] = useState<string[]>([]);
  /** Adelantos/anticipos marcados → monto (USD, string editable) que se cruza con las facturas. */
  const [montosAdelanto, setMontosAdelanto] = useState<Record<string, string>>({});

  /** Total a pagar/cobrar (USD): mientras sea null, se deriva de lo
   *  seleccionado en cada render (cero clics extra en el caso común). Al
   *  tipear a mano queda fijo en ese valor hasta "restablecer". Si supera lo
   *  seleccionado, el excedente es el adelanto/anticipo. */
  const [totalEditadoManual, setTotalEditadoManual] = useState<string | null>(null);
  /** Solo aplica mientras hay una única línea: si es true, el usuario ya
   *  editó el monto a mano y deja de auto-sincronizarse con el total. */
  const [bancaLineaTocada, setBancaLineaTocada] = useState(false);

  const [fecha, setFecha] = useState(hoyNegocio());
  const [descripcion, setDescripcion] = useState('');
  const [comprobantes, setComprobantes] = useState<FotoLocal[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categorias = useCategoriasCobro(!esProveedor);
  const [categoriaCobroId, setCategoriaCobroId] = useState<string | null>(null);
  const envio = useIntentoEnvio();
  const agregarComprobantes = (files: File[]) => {
    const { validos, errores } = filtrarComprobantes(files, comprobantes.length);
    setError(errores.length > 0 ? errores.join(' ') : null);
    setComprobantes(prev => [...prev, ...validos.map(fotoLocalDeFile)]);
  };
  const quitarComprobante = (idx: number) => setComprobantes(prev => prev.filter((_, i) => i !== idx));

  // Un borrador restaurado puede traer ids de facturas, notas o adelantos que ya no están
  // vigentes (se pagaron, anularon o aplicaron): se recortan cuando las listas terminan de cargar.
  const [recortePendiente, setRecortePendiente] = useState(false);
  const [avisoRecorte, setAvisoRecorte] = useState<string | null>(null);

  // Borrador del pago/cobro: sobrevive a F5. Un pago a medias (facturas marcadas, montos, bancas)
  // se recupera al volver a abrir el modal de la misma entidad.
  const estadoBorrador = { montosFactura, notaIdsSel, notaCreditoIdsSel, montosAdelanto, totalEditadoManual, lineasBanca, bancaLineaTocada, fecha, descripcion, comprobantes };
  const hayCambiosBorrador =
    Object.keys(montosFactura).length > 0 || notaIdsSel.length > 0 || notaCreditoIdsSel.length > 0
    || Object.keys(montosAdelanto).length > 0 || totalEditadoManual !== null || descripcion !== ''
    || comprobantes.length > 0 || bancaLineaTocada || lineasBanca.length > 1
    || lineasBanca.some(l => l.montoUsd !== '' || l.referencia !== '');
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: `${esProveedor ? 'pago' : 'cobro'}-registrar`,
    docId: entidadId,
    version: 1,
    estado: estadoBorrador,
    hayCambios: hayCambiosBorrador,
    aplicar: d => {
      setRecortePendiente(true);
      setMontosFactura(d.montosFactura ?? {});
      setNotaIdsSel(d.notaIdsSel ?? []);
      setNotaCreditoIdsSel(d.notaCreditoIdsSel ?? []);
      setMontosAdelanto(d.montosAdelanto ?? {});
      setTotalEditadoManual(d.totalEditadoManual ?? null);
      const lineas = d.lineasBanca ?? [];
      nextLineaId.current = lineas.reduce((max, l) => Math.max(max, l.id + 1), nextLineaId.current);
      setLineasBanca(lineas);
      setBancaLineaTocada(!!d.bancaLineaTocada);
      // Una fecha vieja no se restaura en silencio: el pago/cobro nuevo lleva la fecha de hoy.
      setFecha(fechaRestaurable(d.fecha, hoyNegocio()));
      setDescripcion(d.descripcion ?? '');
      setComprobantes(d.comprobantes ?? []);
    },
    restablecer: () => {
      setMontosFactura({});
      setNotaIdsSel([]);
      setNotaCreditoIdsSel([]);
      setMontosAdelanto({});
      setTotalEditadoManual(null);
      // La cuenta/caja inicia vacía: la persona la elige (obligatoria al registrar).
      setLineasBanca([lineaVacia(nextLineaId.current++)]);
      setBancaLineaTocada(false);
      setDescripcion('');
      setComprobantes([]);
      setRecortePendiente(false);
      setAvisoRecorte(null);
    },
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };
  useCerrarConEscape(cerrar, guardando);

  // Recorta a lo vigente la selección restaurada de un borrador. Si se quitó algo se anula el total
  // fijado a mano: con ítems de menos, ese total dejaría un excedente que se registraría como
  // adelanto/anticipo sin que el usuario lo hubiera decidido.
  useEffect(() => {
    if (!recortePendiente || datos.fase !== 'listo') return;
    const r = recortarSeleccionPago(
      { montosFactura, notaIdsSel, notaCreditoIdsSel, montosAdelanto },
      {
        facturaIds: facturasPendientes.map(f => f.id),
        notaIds: notasDebitoPendientes.flatMap(n => (n.notaId ? [n.notaId] : [])),
        notaCreditoIds: notasCreditoPendientes.flatMap(n => (n.notaId ? [n.notaId] : [])),
        adelantoIds: adelantos.map(a => a.id),
      },
    );
    // Validación única de lo restaurado contra datos que llegan de forma asíncrona: no se puede derivar en render sin perder la limpieza del estado.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecortePendiente(false);
    if (!r.recortado) return;
    setMontosFactura(r.seleccion.montosFactura);
    setNotaIdsSel(r.seleccion.notaIdsSel);
    setNotaCreditoIdsSel(r.seleccion.notaCreditoIdsSel);
    setMontosAdelanto(r.seleccion.montosAdelanto);
    setTotalEditadoManual(null);
    setAvisoRecorte(
      `Del borrador recuperado se quitaron ${r.descartados} ${r.descartados === 1 ? 'selección' : 'selecciones'} que ya no están vigentes (facturas, notas o ${etiquetaAdelanto}s ya pagados, anulados o aplicados). El total a ${verbo} se recalculó: revísalo antes de registrar.`
    );
  }, [recortePendiente, datos.fase, facturasPendientes, adelantos, notasDebitoPendientes, notasCreditoPendientes, montosFactura, notaIdsSel, notaCreditoIdsSel, montosAdelanto, etiquetaAdelanto, verbo]);

  const toggleFactura = (f: FacturaCV) =>
    setMontosFactura(prev => {
      if (!(f.id in prev)) return { ...prev, [f.id]: (f.total - f.montoPagado).toFixed(2) };
      return Object.fromEntries(Object.entries(prev).filter(([id]) => id !== f.id));
    });
  const setMontoFactura = (id: string, value: string) => setMontosFactura(prev => ({ ...prev, [id]: value }));
  const toggleNota = (id: string) => setNotaIdsSel(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const toggleNotaCredito = (id: string) => setNotaCreditoIdsSel(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const facturasSel = useMemo(() => facturasPendientes.filter(f => f.id in montosFactura), [facturasPendientes, montosFactura]);
  const notasSel = useMemo(
    () => notasDebitoPendientes.filter(n => n.notaId && notaIdsSel.includes(n.notaId)),
    [notasDebitoPendientes, notaIdsSel]
  );
  const notasCreditoSel = useMemo(
    () => notasCreditoPendientes.filter(n => n.notaId && notaCreditoIdsSel.includes(n.notaId)),
    [notasCreditoPendientes, notaCreditoIdsSel]
  );
  const adelantosSel = useMemo(() => adelantos.filter(a => a.id in montosAdelanto), [adelantos, montosAdelanto]);

  // Cruce: facturas + notas de débito - adelantos - notas de crédito = lo que
  // hay que pagar en efectivo/banco (ver lib/cruce.ts). Los adelantos y las
  // notas de crédito se usan como método de pago: reducen lo que se paga con banca.
  const itemsCruce: ItemCruce[] = [
    ...facturasSel.map(f => ({ tipo: 'factura' as const, montoUsd: parseFloat(montosFactura[f.id]) || 0 })),
    ...notasSel.map(n => ({ tipo: 'nota_debito' as const, montoUsd: n.cargo })),
    ...adelantosSel.map(a => ({ tipo: 'adelanto' as const, montoUsd: parseFloat(montosAdelanto[a.id]) || 0 })),
    ...notasCreditoSel.map(n => ({ tipo: 'nota_credito' as const, montoUsd: n.abono })),
  ];
  const cruce = calcularCruce(itemsCruce);
  const totalItems = cruce.efectivo;
  const hayItems = itemsCruce.length > 0;

  const totalEditado = totalEditadoManual ?? (hayItems && !cruce.error ? totalItems.toFixed(2) : '');
  const totalEditadoNum = parseFloat(totalEditado) || 0;
  const adelantoCalculado = totalEditadoNum - totalItems;
  /** Hay ítems y no queda nada por pagar: se registra como cruce, sin banca ni movimiento de dinero. */
  const esCrucePuro = hayItems && !cruce.error && totalEditadoNum <= 0.01;

  const toggleAdelanto = (a: AdelantoDisponible) =>
    setMontosAdelanto(prev => {
      if (a.id in prev) return Object.fromEntries(Object.entries(prev).filter(([id]) => id !== a.id));
      // Sugiere lo que falta por cubrir, sin pasarse de las facturas ni de lo disponible.
      const aplicadoOtros = Object.values(prev).reduce((acc, v) => acc + (parseFloat(v) || 0), 0);
      const pendiente = cruce.totalCargos - cruce.totalNotasCredito - aplicadoOtros;
      return { ...prev, [a.id]: sugerirMontoCredito(a.disponible, pendiente).toFixed(2) };
    });
  const setMontoAdelanto = (id: string, value: string) => setMontosAdelanto(prev => ({ ...prev, [id]: value }));

  // Con una sola banca, su monto se muestra igual al total (mismo
  // comportamiento que antes de agregar multi-banco) mientras no se toque a
  // mano — derivado en cada render, no vive en el estado de la línea.
  const lineasEfectivas: LineaBanca[] = lineasBanca.length === 1 && !bancaLineaTocada
    ? [{ ...lineasBanca[0], montoUsd: totalEditado }]
    : lineasBanca;
  const actualizarLinea = (id: number, cambios: Partial<LineaBanca>) =>
    setLineasBanca(prev => prev.map(l => (l.id === id ? { ...l, ...cambios } : l)));
  const accionesLineas = {
    agregar: () => setLineasBanca(prev => {
      // Materializa el monto auto-sincronizado antes de dejar de sincronizar (a partir de 2 líneas cada una se edita a mano).
      const base = prev.length === 1 && !bancaLineaTocada ? [{ ...prev[0], montoUsd: totalEditado }] : prev;
      return [...base, lineaVacia(nextLineaId.current++)];
    }),
    quitar: (id: number) => setLineasBanca(prev => prev.filter(l => l.id !== id)),
    setBanca: (id: number, bancaId: string) => actualizarLinea(id, { bancaId }),
    setMonto: (id: number, montoUsd: string) => {
      actualizarLinea(id, { montoUsd });
      if (lineasBanca.length === 1) setBancaLineaTocada(true);
    },
    setReferencia: (id: number, referencia: string) => actualizarLinea(id, { referencia }),
    setCampos: actualizarLinea,
  };
  /** Bs por USD de una línea: en el pago a proveedor la que se eligió (Binance, BCV o manual); en el cobro, la BCV de siempre. */
  const tasaDeLinea = (l: LineaBanca): number | null =>
    esProveedor ? tasaDePago(l.tasaFuente ?? FUENTE_TASA_PAGO_INICIAL, tasasUsd.tasas, l.tasaManual ?? '') : tasa;

  const sumaBancasUsd = lineasEfectivas.reduce((acc, l) => acc + (parseFloat(l.montoUsd) || 0), 0);
  const sumaBancasCuadra = Math.abs(sumaBancasUsd - totalEditadoNum) <= 0.01;

  const descripcionSugerida = useMemo(() => {
    const partes: string[] = [];
    facturasSel.forEach(f => partes.push(f.codigo ?? f.id.slice(0, 8)));
    if (notasSel.length > 0) partes.push(`${notasSel.length} nota${notasSel.length === 1 ? '' : 's'} débito`);
    if (notasCreditoSel.length > 0) partes.push(`${notasCreditoSel.length} nota${notasCreditoSel.length === 1 ? '' : 's'} crédito aplicada${notasCreditoSel.length === 1 ? '' : 's'}`);
    if (adelantosSel.length > 0) partes.push(`${etiquetaAdelanto}${adelantosSel.length === 1 ? '' : 's'} aplicado${adelantosSel.length === 1 ? '' : 's'}: ${adelantosSel.map(a => a.codigo ?? a.id.slice(0, 8)).join(', ')}`);
    if (adelantoCalculado > 0.01) partes.push(`${etiquetaAdelanto} $${fmt(adelantoCalculado)}`);
    if (partes.length === 0) return '';
    return `${esCrucePuro ? 'Cruce' : esProveedor ? 'Pago combinado' : 'Cobro combinado'}: ${partes.join(', ')}`;
  }, [facturasSel, notasSel, notasCreditoSel, adelantosSel, adelantoCalculado, etiquetaAdelanto, esProveedor, esCrucePuro]);

  const bloqueoCarga = bloqueoPorCarga(datos.fase);
  const bloqueoCategorias = categoriasBloqueanCobro(categorias, !esProveedor && !esCrucePuro);

  const registrar = async () => {
    const validacion = validarPagoCobro({
      esProveedor, etiquetaAdelanto, cruce, hayItems, esCrucePuro, totalItems, totalEditadoNum,
      facturasSel, montosFactura, notasSel, notasCreditoSel, adelantosSel, montosAdelanto,
      lineas: lineasEfectivas, bancas, tasaDeLinea,
      comision: { estado: comisionDisponible.estado, disponible: comisionDisponible.disponible },
      categorias, categoriaCobroId,
    });
    if ('error' in validacion) { setError(validacion.error); return; }
    const datosEnvio = {
      esProveedor, entidadId, bancas: validacion.bancas, items: validacion.items, esCrucePuro, hayDinero: validacion.hayDinero,
      totalEditadoNum, descripcion: descripcion.trim() || descripcionSugerida, fecha, comprobantes,
      categoriaOpciones: categorias.opciones, categoriaCobroId,
    };
    // Misma clave mientras no cambien los datos: un reintento tras un corte no duplica el registro.
    const resultado = await enviarPagoCobro(datosEnvio, envio.idPara(huellaPagoCobro(datosEnvio)));
    if ('error' in resultado) { setError(resultado.error); return; }
    envio.renovar();
    borrador.limpiar();
    onRegistrado(resultado.resultado);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bloqueoCarga || !envio.iniciar()) return;
    setError(null);
    setGuardando(true);
    try { await registrar(); } finally { setGuardando(false); envio.terminar(); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={tituloId} className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div>
            <h2 id={tituloId} className="text-lg font-bold text-text-primary">{etiquetaAccion}</h2>
            <p className="text-sm text-text-secondary">Selecciona facturas y/o notas de débito y cruzalas con {esProveedor ? 'adelantos' : 'anticipos'} y notas de crédito, o regístralo como {etiquetaAdelanto}.</p>
          </div>
          <button type="button" onClick={cerrar} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors p-2 -m-2">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="overflow-y-auto p-5 space-y-4 flex-1 min-h-0">
            <AvisoBorrador formulario={esProveedor ? 'este pago' : 'este cobro'} aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
            {avisoRecorte && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoRecorte}</p>}
            <AvisoCargaPago fase={datos.fase} mensajeError={datos.mensajeError} onReintentar={datos.reintentar} />

            {datos.fase === 'listo' && (
              <div>
                <label className={labelClass}>Facturas pendientes</label>
                <ListaFacturasPago facturas={facturasPendientes} montos={montosFactura} esProveedor={esProveedor} onToggle={toggleFactura} onMonto={setMontoFactura} />
              </div>
            )}

            <div>
              <label className={labelClass}>Notas de débito pendientes</label>
              <ListaNotasPago notas={notasDebitoPendientes} seleccionadas={notaIdsSel} tipo="debito" textoVacio="Sin notas de débito pendientes." onToggle={toggleNota} />
            </div>

            {datos.fase === 'listo' && (
              <div>
                <label className={labelClass}>{esProveedor ? 'Adelantos' : 'Anticipos'} disponibles <span className="text-text-muted">(se descuentan de lo que hay que {verbo})</span></label>
                <ListaAdelantosPago adelantos={adelantos} montos={montosAdelanto} esProveedor={esProveedor} onToggle={toggleAdelanto} onMonto={setMontoAdelanto} />
              </div>
            )}

            <div>
              <label className={labelClass}>Notas de crédito disponibles <span className="text-text-muted">(se aplican como método de {esProveedor ? 'pago' : 'cobro'})</span></label>
              <ListaNotasPago notas={notasCreditoPendientes} seleccionadas={notaCreditoIdsSel} tipo="credito" textoVacio="Sin notas de crédito disponibles." onToggle={toggleNotaCredito} />
            </div>

            <ResumenTotalPago
              cruce={cruce} hayItems={hayItems} esProveedor={esProveedor} verbo={verbo} etiquetaAdelanto={etiquetaAdelanto}
              codigoAdelanto={esProveedor ? 'AD-…' : 'AC-…'} esCrucePuro={esCrucePuro} totalEditado={totalEditado}
              totalTocado={totalEditadoManual !== null} totalItems={totalItems} totalEditadoNum={totalEditadoNum}
              adelantoCalculado={adelantoCalculado} onTotal={setTotalEditadoManual} onRestablecer={() => setTotalEditadoManual(null)}
            />

            {!esCrucePuro && (
              <SeccionBancasPago
                etiqueta={esProveedor ? 'Banca(s) de origen' : 'Banca(s) de destino'} esProveedor={esProveedor} bancas={bancas}
                lineas={lineasEfectivas} tasaBcv={tasa} tasasUsd={tasasUsd} comisionEstado={comisionDisponible.estado}
                tasaDeLinea={tasaDeLinea} acciones={accionesLineas} onReintentarComision={comisionDisponible.reintentar}
                sumaUsd={sumaBancasUsd} totalUsd={totalEditadoNum} cuadra={sumaBancasCuadra}
              />
            )}

            <div>
              <label className={labelClass}>Fecha</label>
              <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
            </div>

            {!esProveedor && !esCrucePuro && <AvisoCategoriasCobro cargando={categorias.cargando} fallo={categorias.fallo} onReintentar={categorias.reintentar} />}
            {!esProveedor && cobroPideCategoria(categorias.opciones, !esCrucePuro) &&
              <CategoriaCobroBotones opciones={categorias.opciones} valor={categoriaCobroId} onChange={setCategoriaCobroId} disabled={guardando} />}

            <div>
              <label className={labelClass}>Descripción <span className="text-text-muted">(opcional)</span></label>
              <input
                type="text" maxLength={300}
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                className={inputClass}
                placeholder={descripcionSugerida || `Ej: ${esProveedor ? 'Pago' : 'Cobro'} combinado de facturas`}
              />
            </div>

            {!esCrucePuro && (
              <FotoMultiplePicker
                fotos={comprobantes}
                onAgregar={agregarComprobantes}
                onQuitar={quitarComprobante}
                label={`Comprobante de ${esProveedor ? 'pago' : 'cobro'} (opcional)`}
              />
            )}
          </div>

          {/* Pie fijo: el total y el botón de registrar siempre a la vista, también con el teclado abierto en el celular. */}
          <div className="shrink-0 border-t border-border bg-surface p-4 space-y-2 rounded-b-2xl">
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-24 overflow-y-auto">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-text-secondary">Total a {verbo}</span>
              <span className="text-lg font-bold text-text-primary">${fmt(totalEditadoNum)}</span>
            </div>
            {bloqueoCarga && datos.fase === 'cargando' && <p className="text-xs text-text-muted">{bloqueoCarga}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={cerrar} className="flex-1 min-h-11 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardando || bloqueoCarga !== null || bloqueoCategorias}
                className="flex-1 min-h-11 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {guardando ? 'Registrando...' : esCrucePuro ? 'Registrar cruce' : etiquetaAccion}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PagoCobroModal;
