import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { obtenerBancas } from '../../services/banca-service';
import { obtenerTasaOficial } from '../../services/tasa-service';
import { obtenerFacturas } from '../../services/factura-cv-service';
import { registrarPagoMultiple, type BancaPago, type ItemPagoMultiple } from '../../services/pago-service';
import { registrarCobroMultiple, type ResultadoCobroMultiple } from '../../services/cobro-service';
import { obtenerAdelantosDisponibles, type AdelantoDisponible } from '../../services/cruce-service';
import { subirComprobantePago } from '../../services/storage-service';
import { tieneSaldoPendiente } from '../../lib/estado-factura';
import { calcularCruce, redondear2, sugerirMontoCredito, validarMontoAplicable, type ItemCruce } from '../../lib/cruce';
import { fotoLocalDeFile, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import { filtrarComprobantes } from '../../lib/comprobante-imagen';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import AvisoBorrador from '../../components/AvisoBorrador';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { fechaRestaurable, recortarSeleccionPago } from '../../lib/borrador-vigentes';
import type { Banca } from '@shared/types/index.js';
import type { FacturaCV } from '../../services/factura-cv-service';
import type { EntradaEstadoCuenta, TipoEntidad } from '../../services/estado-cuenta-service';
import { hoyNegocio } from '../../lib/fecha-negocio';

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

interface LineaBanca {
  id: number;
  bancaId: string;
  /** USD, string editable. */
  montoUsd: string;
  /** Referencia propia de esta banca (ej. número de transferencia). */
  referencia: string;
}

function hoyISO(): string {
  return hoyNegocio();
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

/** "Registrar pago" (proveedor) / "Registrar cobro" (cliente) — misma
 *  pantalla (Bloque 45), la única diferencia real es el sentido del dinero
 *  (sale de una banca vs entra a una banca) y a qué RPC/tabla apunta. */
function PagoCobroModal({ tipoEntidad, entidadId, notasDebitoPendientes, notasCreditoPendientes, onClose, onRegistrado }: Props) {
  const esProveedor = tipoEntidad === 'proveedor';
  const verbo = esProveedor ? 'pagar' : 'cobrar';
  const etiquetaAccion = esProveedor ? 'Registrar pago' : 'Registrar cobro';
  const etiquetaBanca = esProveedor ? 'Banca(s) de origen' : 'Banca(s) de destino';
  const etiquetaAdelanto = esProveedor ? 'adelanto' : 'anticipo';
  const codigoAdelanto = esProveedor ? 'AD-…' : 'AC-…';

  const [bancas, setBancas] = useState<Banca[]>([]);
  const [tasa, setTasa] = useState<number | null>(null);
  const [facturasPendientes, setFacturasPendientes] = useState<FacturaCV[]>([]);
  /** Facturas marcadas → monto (USD, string editable) que se les aplica de este pago.
   *  Por defecto el saldo pendiente completo, pero se puede bajar para un pago parcial. */
  const [montosFactura, setMontosFactura] = useState<Record<string, string>>({});
  const [notaIdsSel, setNotaIdsSel] = useState<string[]>([]);
  const [notaCreditoIdsSel, setNotaCreditoIdsSel] = useState<string[]>([]);
  const [adelantos, setAdelantos] = useState<AdelantoDisponible[]>([]);
  /** Adelantos/anticipos marcados → monto (USD, string editable) que se cruza con las facturas. */
  const [montosAdelanto, setMontosAdelanto] = useState<Record<string, string>>({});

  /** Total a pagar/cobrar (USD): mientras sea null, se deriva de lo
   *  seleccionado en cada render (cero clics extra en el caso común). Al
   *  tipear a mano queda fijo en ese valor hasta "restablecer". Si supera lo
   *  seleccionado, el excedente es el adelanto/anticipo. */
  const [totalEditadoManual, setTotalEditadoManual] = useState<string | null>(null);

  const nextLineaId = useRef(0);
  const [lineasBanca, setLineasBanca] = useState<LineaBanca[]>([]);
  /** Solo aplica mientras hay una única línea: si es true, el usuario ya
   *  editó el monto a mano y deja de auto-sincronizarse con el total. */
  const [bancaLineaTocada, setBancaLineaTocada] = useState(false);

  const [fecha, setFecha] = useState(hoyISO());
  const [descripcion, setDescripcion] = useState('');
  const [comprobantes, setComprobantes] = useState<FotoLocal[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agregarComprobantes = (files: File[]) => {
    const { validos, errores } = filtrarComprobantes(files, comprobantes.length);
    setError(errores.length > 0 ? errores.join(' ') : null);
    setComprobantes(prev => [...prev, ...validos.map(fotoLocalDeFile)]);
  };
  const quitarComprobante = (idx: number) => setComprobantes(prev => prev.filter((_, i) => i !== idx));

  // Un borrador restaurado puede traer ids de facturas, notas o adelantos que ya no están
  // vigentes (se pagaron, anularon o aplicaron): se recortan cuando las listas terminan de cargar.
  const [facturasCargadas, setFacturasCargadas] = useState(false);
  const [adelantosCargados, setAdelantosCargados] = useState(false);
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
      setFecha(fechaRestaurable(d.fecha, hoyISO()));
      setDescripcion(d.descripcion ?? '');
      setComprobantes(d.comprobantes ?? []);
    },
    restablecer: () => {
      setMontosFactura({});
      setNotaIdsSel([]);
      setNotaCreditoIdsSel([]);
      setMontosAdelanto({});
      setTotalEditadoManual(null);
      setLineasBanca(bancas.length > 0 ? [{ id: nextLineaId.current++, bancaId: bancas[0].id, montoUsd: '', referencia: '' }] : []);
      setBancaLineaTocada(false);
      setDescripcion('');
      setComprobantes([]);
      setRecortePendiente(false);
      setAvisoRecorte(null);
    },
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  useEffect(() => {
    obtenerBancas().then(lista => {
      setBancas(lista);
      // Si ya hay líneas (borrador restaurado) se conservan; solo se crea la inicial cuando no hay ninguna.
      setLineasBanca(prev => (prev.length > 0 ? prev : [{ id: nextLineaId.current++, bancaId: lista[0]?.id ?? '', montoUsd: '', referencia: '' }]));
    });
    obtenerTasaOficial().then(t => setTasa(t?.tasa ?? null));
    obtenerFacturas(esProveedor ? 'compra' : 'venta', { entidadId }).then(lista => {
      setFacturasPendientes(lista.filter(f => tieneSaldoPendiente(f.estado)));
      setFacturasCargadas(true);
    });
    obtenerAdelantosDisponibles(tipoEntidad, entidadId).then(lista => {
      setAdelantos(lista);
      setAdelantosCargados(true);
    });
  }, [esProveedor, tipoEntidad, entidadId]);

  // Recorta a lo vigente la selección restaurada de un borrador. Si se quitó algo se anula el total
  // fijado a mano: con ítems de menos, ese total dejaría un excedente que se registraría como
  // adelanto/anticipo sin que el usuario lo hubiera decidido.
  useEffect(() => {
    if (!recortePendiente || !facturasCargadas || !adelantosCargados) return;
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
  }, [recortePendiente, facturasCargadas, adelantosCargados, facturasPendientes, adelantos, notasDebitoPendientes, notasCreditoPendientes, montosFactura, notaIdsSel, notaCreditoIdsSel, montosAdelanto, etiquetaAdelanto, verbo]);

  const toggleFactura = (f: FacturaCV) =>
    setMontosFactura(prev => {
      if (!(f.id in prev)) return { ...prev, [f.id]: (f.total - f.montoPagado).toFixed(2) };
      const next = { ...prev };
      delete next[f.id];
      return next;
    });
  const setMontoFactura = (id: string, value: string) =>
    setMontosFactura(prev => ({ ...prev, [id]: value }));
  const toggleNota = (id: string) =>
    setNotaIdsSel(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const toggleNotaCredito = (id: string) =>
    setNotaCreditoIdsSel(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const facturasSel = useMemo(
    () => facturasPendientes.filter(f => f.id in montosFactura),
    [facturasPendientes, montosFactura]
  );
  const notasSel = useMemo(
    () => notasDebitoPendientes.filter(n => n.notaId && notaIdsSel.includes(n.notaId)),
    [notasDebitoPendientes, notaIdsSel]
  );
  const notasCreditoSel = useMemo(
    () => notasCreditoPendientes.filter(n => n.notaId && notaCreditoIdsSel.includes(n.notaId)),
    [notasCreditoPendientes, notaCreditoIdsSel]
  );

  const adelantosSel = useMemo(
    () => adelantos.filter(a => a.id in montosAdelanto),
    [adelantos, montosAdelanto]
  );

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

  const totalTocado = totalEditadoManual !== null;
  const totalEditado = totalEditadoManual ?? (hayItems && !cruce.error ? totalItems.toFixed(2) : '');
  const totalEditadoNum = parseFloat(totalEditado) || 0;
  const adelantoCalculado = totalEditadoNum - totalItems;
  /** Hay ítems y no queda nada por pagar: se registra como cruce, sin banca ni movimiento de dinero. */
  const esCrucePuro = hayItems && !cruce.error && totalEditadoNum <= 0.01;

  const toggleAdelanto = (a: AdelantoDisponible) =>
    setMontosAdelanto(prev => {
      if (!(a.id in prev)) {
        // Sugiere lo que falta por cubrir, sin pasarse de las facturas ni de lo disponible.
        const aplicadoOtros = Object.entries(prev).reduce((acc, [, v]) => acc + (parseFloat(v) || 0), 0);
        const pendiente = cruce.totalCargos - cruce.totalNotasCredito - aplicadoOtros;
        return { ...prev, [a.id]: sugerirMontoCredito(a.disponible, pendiente).toFixed(2) };
      }
      const next = { ...prev };
      delete next[a.id];
      return next;
    });
  const setMontoAdelanto = (id: string, value: string) =>
    setMontosAdelanto(prev => ({ ...prev, [id]: value }));

  // Con una sola banca, su monto se muestra igual al total (mismo
  // comportamiento que antes de agregar multi-banco) mientras no se toque a
  // mano — derivado en cada render, no vive en el estado de la línea.
  const lineasEfectivas: LineaBanca[] = lineasBanca.length === 1 && !bancaLineaTocada
    ? [{ ...lineasBanca[0], montoUsd: totalEditado }]
    : lineasBanca;

  const bancasUsadas = new Set(lineasBanca.map(l => l.bancaId).filter(Boolean));
  const agregarLinea = () => {
    const disponible = bancas.find(b => !bancasUsadas.has(b.id));
    setLineasBanca(prev => {
      // Materializa el monto auto-sincronizado antes de dejar de sincronizar
      // (a partir de 2 líneas cada una se edita a mano).
      const base = prev.length === 1 && !bancaLineaTocada
        ? [{ ...prev[0], montoUsd: totalEditado }]
        : prev;
      return [...base, { id: nextLineaId.current++, bancaId: disponible?.id ?? '', montoUsd: '', referencia: '' }];
    });
  };
  const quitarLinea = (id: number) =>
    setLineasBanca(prev => prev.filter(l => l.id !== id));
  const setLineaBancaId = (id: number, bancaId: string) =>
    setLineasBanca(prev => prev.map(l => (l.id === id ? { ...l, bancaId } : l)));
  const setLineaMonto = (id: number, montoUsd: string) => {
    setLineasBanca(prev => prev.map(l => (l.id === id ? { ...l, montoUsd } : l)));
    if (lineasBanca.length === 1) setBancaLineaTocada(true);
  };
  const setLineaReferencia = (id: number, referencia: string) =>
    setLineasBanca(prev => prev.map(l => (l.id === id ? { ...l, referencia } : l)));

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (cruce.error) { setError(cruce.error); return; }
    if (!hayItems && totalEditadoNum <= 0) { setError(`Seleccioná al menos una factura, nota o ${etiquetaAdelanto}, o indicá un monto a ${verbo}.`); return; }
    if (adelantoCalculado < -0.01) {
      setError(`El total a ${verbo} ($${fmt(totalEditadoNum)}) es menor a lo seleccionado ($${fmt(totalItems)}). Bajá el monto de alguna factura o desmarcala.`);
      return;
    }

    for (const f of facturasSel) {
      const monto = parseFloat(montosFactura[f.id]) || 0;
      const saldoFactura = f.total - f.montoPagado;
      const nombre = f.codigo ?? f.id.slice(0, 8);
      if (monto <= 0) { setError(`El monto de ${nombre} debe ser mayor a 0.`); return; }
      if (monto > saldoFactura + 0.01) {
        setError(`El monto de ${nombre} supera su saldo pendiente ($${fmt(saldoFactura)}).`);
        return;
      }
    }

    for (const a of adelantosSel) {
      const mensaje = validarMontoAplicable(parseFloat(montosAdelanto[a.id]) || 0, a.disponible, a.codigo ?? etiquetaAdelanto);
      if (mensaje) { setError(mensaje); return; }
    }

    // Cruce puro: no se mueve dinero, no hace falta banca ni método de pago.
    const bancasPayload: BancaPago[] = [];
    if (!esCrucePuro) {
    if (lineasEfectivas.length === 0 || lineasEfectivas.some(l => !l.bancaId)) {
      setError('Seleccioná una banca válida en cada línea.');
      return;
    }
    const idsBanca = lineasEfectivas.map(l => l.bancaId);
    if (new Set(idsBanca).size !== idsBanca.length) {
      setError(`No podés repetir la misma banca en un ${esProveedor ? 'pago' : 'cobro'}.`);
      return;
    }

    for (const linea of lineasEfectivas) {
      const banca = bancas.find(b => b.id === linea.bancaId);
      if (!banca) { setError('Banca no encontrada.'); return; }
      const montoUsdLinea = parseFloat(linea.montoUsd) || 0;
      if (montoUsdLinea <= 0) { setError(`Cargá un monto para ${banca.nombre}.`); return; }
      const esBsLinea = banca.moneda === 'VES';
      if (esBsLinea && !tasa) { setError('No hay tasa de cambio disponible para convertir a bolívares.'); return; }
      const montoBanca = esBsLinea && tasa ? montoUsdLinea * tasa : montoUsdLinea;
      // Un pago a proveedor no bloquea si supera el saldo disponible (puede
      // quedar en negativo); un cobro de cliente nunca podría dejar una
      // banca en negativo (siempre suma), así que no aplica ninguno de los
      // dos casos acá.
      bancasPayload.push({
        bancaId: banca.id,
        monto: montoBanca,
        moneda: banca.moneda as 'USD' | 'VES',
        montoUsd: montoUsdLinea,
        referencia: linea.referencia.trim() || null,
      });
    }

    if (!sumaBancasCuadra) {
      setError(`La suma de las bancas ($${fmt(sumaBancasUsd)}) no coincide con el total a ${verbo} ($${fmt(totalEditadoNum)}).`);
      return;
    }
    }

    const items: ItemPagoMultiple[] = [
      ...facturasSel.map(f => ({ tipo: 'factura' as const, id: f.id, montoUsd: parseFloat(montosFactura[f.id]) || 0 })),
      ...notasSel.map(n => ({ tipo: 'nota_debito' as const, id: n.notaId!, montoUsd: n.cargo })),
      ...notasCreditoSel.map(n => ({ tipo: 'nota_credito' as const, id: n.notaId!, montoUsd: n.abono })),
      ...adelantosSel.map(a => ({ tipo: 'adelanto' as const, id: a.id, montoUsd: redondear2(parseFloat(montosAdelanto[a.id]) || 0) })),
    ];

    setGuardando(true);

    // Un cruce puro no mueve dinero: no hay movimiento al que colgar comprobantes.
    const comprobantesUrls = esCrucePuro ? [] : await subirFotosLocal(comprobantes, subirComprobantePago);
    if (!comprobantesUrls) {
      setGuardando(false);
      setError('No se pudo subir uno de los comprobantes. Probá de nuevo o registrá el pago sin ellos.');
      return;
    }

    const datosComunes = {
      bancas: bancasPayload,
      montoUsd: esCrucePuro ? 0 : totalEditadoNum,
      descripcion: (descripcion.trim() || descripcionSugerida) || null,
      fecha,
      items,
      comprobantes: comprobantesUrls,
    };

    if (esProveedor) {
      const result = await registrarPagoMultiple({ proveedorId: entidadId, ...datosComunes });
      setGuardando(false);
      if ('error' in result) { setError(result.error); return; }
      borrador.limpiar();
      onRegistrado({
        movimientoPrincipalId: result.movimientoPrincipalId,
        movimientoIds: result.movimientoIds,
        grupoId: result.grupoId,
        numeroCobro: result.numeroPago,
        numeroAnticipo: result.numeroAdelanto,
        numeroCruce: result.numeroCruce,
      });
      return;
    }

    const result = await registrarCobroMultiple({ clienteId: entidadId, ...datosComunes });
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    borrador.limpiar();
    onRegistrado(result);
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <div>
            <h2 className="text-lg font-bold text-text-primary">{etiquetaAccion}</h2>
            <p className="text-sm text-text-secondary">Selecciona facturas y/o notas de débito y cruzalas con {esProveedor ? 'adelantos' : 'anticipos'} y notas de crédito, o regístralo como {etiquetaAdelanto}.</p>
          </div>
          <button type="button" onClick={cerrar} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <AvisoBorrador formulario={esProveedor ? 'este pago' : 'este cobro'} aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
          {avisoRecorte && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">{avisoRecorte}</p>}
          <div>
            <label className={labelClass}>Facturas pendientes</label>
            {facturasPendientes.length === 0 ? (
              <p className="text-xs text-text-muted">Sin facturas pendientes.</p>
            ) : (
              <>
              <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                {facturasPendientes.map(f => {
                  const marcada = f.id in montosFactura;
                  const saldoFactura = f.total - f.montoPagado;
                  return (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-alt transition-colors">
                      <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={marcada}
                          onChange={() => toggleFactura(f)}
                          className="w-4 h-4 accent-brand-600 shrink-0"
                        />
                        <span className="text-sm text-text-primary truncate">{f.codigo ?? f.id.slice(0, 8)}</span>
                      </label>
                      {marcada ? (
                        <div className="relative shrink-0">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs">$</span>
                          <input
                            type="number" step="0.01" min="0.01" max={saldoFactura.toFixed(2)}
                            value={montosFactura[f.id]}
                            onChange={e => setMontoFactura(f.id, e.target.value)}
                            className="w-24 pl-5 pr-2 py-1 text-right text-xs bg-surface border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted shrink-0">${fmt(saldoFactura)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-text-muted mt-1">
                Al marcar una factura se aplica su saldo completo por defecto — el monto es editable para un {esProveedor ? 'pago' : 'cobro'} parcial.
              </p>
              </>
            )}
          </div>

          <div>
            <label className={labelClass}>Notas de débito pendientes</label>
            {notasDebitoPendientes.length === 0 ? (
              <p className="text-xs text-text-muted">Sin notas de débito pendientes.</p>
            ) : (
              <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                {notasDebitoPendientes.map(n => (
                  <label key={n.notaId} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-alt transition-colors">
                    <input
                      type="checkbox"
                      checked={!!n.notaId && notaIdsSel.includes(n.notaId)}
                      onChange={() => n.notaId && toggleNota(n.notaId)}
                      className="w-4 h-4 accent-brand-600 shrink-0"
                    />
                    <span className="text-sm text-text-primary flex-1 flex items-center justify-between gap-2">
                      <span className="truncate">{n.descripcion}</span>
                      <span className="text-text-muted shrink-0">${fmt(n.cargo)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>{esProveedor ? 'Adelantos' : 'Anticipos'} disponibles <span className="text-text-muted">(se descuentan de lo que hay que {verbo})</span></label>
            {adelantos.length === 0 ? (
              <p className="text-xs text-text-muted">Sin {esProveedor ? 'adelantos' : 'anticipos'} con saldo disponible.</p>
            ) : (
              <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                {adelantos.map(a => {
                  const marcado = a.id in montosAdelanto;
                  return (
                    <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-alt transition-colors">
                      <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => toggleAdelanto(a)}
                          className="w-4 h-4 accent-brand-600 shrink-0"
                        />
                        <span className="text-sm text-text-primary truncate">
                          {a.codigo ?? a.id.slice(0, 8)}
                          <span className="text-xs text-text-muted ml-2">{a.fecha}</span>
                        </span>
                      </label>
                      {marcado ? (
                        <div className="relative shrink-0">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs">$</span>
                          <input
                            type="number" step="0.01" min="0.01" max={a.disponible.toFixed(2)}
                            value={montosAdelanto[a.id]}
                            onChange={e => setMontoAdelanto(a.id, e.target.value)}
                            className="w-24 pl-5 pr-2 py-1 text-right text-xs bg-surface border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-400"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-teal-700 shrink-0">${fmt(a.disponible)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>Notas de crédito disponibles <span className="text-text-muted">(se aplican como método de {esProveedor ? 'pago' : 'cobro'})</span></label>
            {notasCreditoPendientes.length === 0 ? (
              <p className="text-xs text-text-muted">Sin notas de crédito disponibles.</p>
            ) : (
              <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                {notasCreditoPendientes.map(n => (
                  <label key={n.notaId} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-alt transition-colors">
                    <input
                      type="checkbox"
                      checked={!!n.notaId && notaCreditoIdsSel.includes(n.notaId)}
                      onChange={() => n.notaId && toggleNotaCredito(n.notaId)}
                      className="w-4 h-4 accent-brand-600 shrink-0"
                    />
                    <span className="text-sm text-text-primary flex-1 flex items-center justify-between gap-2">
                      <span className="truncate">{n.descripcion}</span>
                      <span className="text-green-600 shrink-0">-${fmt(n.abono)}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {hayItems && (
            <div className="border border-border rounded-lg px-4 py-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-text-secondary">Facturas seleccionadas</span><span className="text-text-primary">${fmt(cruce.totalFacturas)}</span></div>
              {cruce.totalNotasDebito > 0 && (
                <div className="flex justify-between"><span className="text-text-secondary">+ Notas de débito</span><span className="text-text-primary">${fmt(cruce.totalNotasDebito)}</span></div>
              )}
              {cruce.totalAdelantos > 0 && (
                <div className="flex justify-between"><span className="text-text-secondary">- {esProveedor ? 'Adelantos' : 'Anticipos'} aplicados</span><span className="text-green-600">-${fmt(cruce.totalAdelantos)}</span></div>
              )}
              {cruce.totalNotasCredito > 0 && (
                <div className="flex justify-between"><span className="text-text-secondary">- Notas de crédito</span><span className="text-green-600">-${fmt(cruce.totalNotasCredito)}</span></div>
              )}
              <div className="flex justify-between pt-1 border-t border-border font-semibold">
                <span className="text-text-primary">= A {verbo} en efectivo/banco</span>
                <span className="text-text-primary">${fmt(cruce.efectivo)}</span>
              </div>
            </div>
          )}

          {cruce.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-600">{cruce.error}</p>
            </div>
          )}

          <div className="bg-brand-50 border border-brand-200 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-brand-800 shrink-0">Total a {verbo} (efectivo/banco)</span>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-700 text-sm">$</span>
                <input
                  type="number" step="0.001" min="0"
                  value={totalEditado}
                  onChange={e => setTotalEditadoManual(e.target.value)}
                  className="w-32 pl-6 pr-2 py-1.5 text-right text-lg font-bold text-brand-700 bg-surface border border-brand-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
            </div>
            {totalTocado && (
              <button
                type="button"
                onClick={() => setTotalEditadoManual(null)}
                className="text-xs text-brand-700 hover:underline mt-1"
              >
                restablecer a ${fmt(totalItems)}
              </button>
            )}
          </div>

          {adelantoCalculado > 0.01 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <p className="text-sm text-amber-800">
                Se registrará un <strong>{etiquetaAdelanto} de ${fmt(adelantoCalculado)}</strong> como ticket aparte (correlativo {codigoAdelanto}).
              </p>
            </div>
          )}
          {adelantoCalculado < -0.01 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-600">
                El total a {verbo} (${fmt(totalEditadoNum)}) es menor a lo seleccionado (${fmt(totalItems)}). Bajá el monto de alguna factura o desmarcala.
              </p>
            </div>
          )}

          {esCrucePuro && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
              <p className="text-sm text-indigo-800">
                <strong>Cruce sin movimiento de dinero:</strong> lo seleccionado queda saldado con {esProveedor ? 'adelantos' : 'anticipos'} y notas. No hace falta banca ni método de {esProveedor ? 'pago' : 'cobro'}; se guarda como documento de cruce (correlativo {esProveedor ? 'CR-…' : 'CRV-…'}).
              </p>
            </div>
          )}

          {!esCrucePuro && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelClass}>{etiquetaBanca} *</label>
              {lineasBanca.length < bancas.length && (
                <button
                  type="button"
                  onClick={agregarLinea}
                  className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  <Plus size={13} /> Agregar banca
                </button>
              )}
            </div>

            <div className="space-y-2">
              {lineasEfectivas.map(linea => {
                const banca = bancas.find(b => b.id === linea.bancaId);
                const esBsLinea = banca?.moneda === 'VES';
                const montoUsdLinea = parseFloat(linea.montoUsd) || 0;
                const montoBsLinea = esBsLinea && tasa ? montoUsdLinea * tasa : null;
                return (
                  <div key={linea.id} className="border border-border rounded-lg p-2 space-y-2">
                    <div className="flex flex-col sm:flex-row items-start gap-2">
                      <select
                        required
                        value={linea.bancaId}
                        onChange={e => setLineaBancaId(linea.id, e.target.value)}
                        className={`${inputClass} w-full sm:flex-1`}
                      >
                        {bancas
                          .filter(b => b.id === linea.bancaId || !bancasUsadas.has(b.id))
                          .map(b => (
                            <option key={b.id} value={b.id}>
                              {b.nombre} — {b.moneda === 'USD' ? '$' : 'Bs '}{b.saldo.toLocaleString()}
                            </option>
                          ))}
                      </select>
                      <div className="flex items-start gap-2 w-full sm:w-auto">
                        <div className="shrink-0">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
                            <input
                              type="number" step="0.001" min="0.01"
                              value={linea.montoUsd}
                              onChange={e => setLineaMonto(linea.id, e.target.value)}
                              className={`${inputClass} w-28 pl-6`}
                              placeholder="0.00"
                            />
                          </div>
                          {montoBsLinea != null && (
                            <p className="text-xs text-text-muted mt-1 text-right">≈ Bs {fmt(montoBsLinea)}</p>
                          )}
                        </div>
                        {lineasBanca.length > 1 && (
                          <button
                            type="button"
                            onClick={() => quitarLinea(linea.id)}
                            className="p-2.5 text-text-muted hover:text-red-600 transition-colors shrink-0"
                            title="Quitar banca"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="text" maxLength={50}
                      value={linea.referencia}
                      onChange={e => setLineaReferencia(linea.id, e.target.value)}
                      className={`${inputClass} text-xs`}
                      placeholder="Referencia de esta banca (opcional) — ej: TRF-432"
                    />
                  </div>
                );
              })}
            </div>

            {!tasa && lineasBanca.some(l => bancas.find(b => b.id === l.bancaId)?.moneda === 'VES') && (
              <p className="text-xs text-red-600 mt-1">No se pudo obtener la tasa de cambio.</p>
            )}

            <p className={`text-xs mt-2 ${sumaBancasCuadra ? 'text-green-600' : 'text-red-600'}`}>
              Suma de bancas: ${fmt(sumaBancasUsd)} de ${fmt(totalEditadoNum)}
              {!sumaBancasCuadra && ` (faltan $${fmt(totalEditadoNum - sumaBancasUsd)})`}
            </p>
          </div>
          )}

          <div>
            <label className={labelClass}>Fecha</label>
            <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} />
          </div>

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

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Registrando...' : esCrucePuro ? 'Registrar cruce' : etiquetaAccion}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PagoCobroModal;
