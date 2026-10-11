import { useEffect, useState } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ChevronDown } from 'lucide-react';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import SelectorBanca from './SelectorBanca';
import { registrarMovimiento } from '../../services/comision-bancaria-service';
import { crearTransferenciaMesa } from '../../services/transferencia-mesa-service';
import MesaCambioCampos from './MesaCambioCampos';
import { useTransferenciaMesa } from './useTransferenciaMesa';
import ComisionBancariaCampo, { AvisoComisionNoVerificada, AvisoMesaSinComisionBancaria } from './ComisionBancariaCampo';
import { validarMovimiento } from './validar-movimiento';
import EquivalenteUsd from './EquivalenteUsd';
import { useComisionDisponible } from './useComisionDisponible';
import {
  bloqueoPorComision, llevaDeOpcion, mostrarAvisoMesaSinComision, ofrecerComision, planDeComision, type OpcionComision,
} from './comision-formulario';
import type { EstadoTasasUsd } from './equivalente-usd';
import { cuerpoTransferenciaMesa } from './transferencia-mesa';
import { obtenerProveedores } from '../../services/proveedor-service';
import { obtenerClientes } from '../../services/cliente-service';
import { obtenerTasa, type FuenteTasaKey } from '../../services/tasa-service';
import { subirComprobantePago } from '../../services/storage-service';
import { fotoLocalDeFile, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import { filtrarComprobantes } from '../../lib/comprobante-imagen';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import { useAuth } from '../../hooks/use-auth-context';
import type { Banca } from '@shared/types/index.js';
import { hoyNegocio } from '../../lib/fecha-negocio';
import { bancasEditables } from '../usuarios/acceso-bancas';
import SelectorCategoria from './categorias/SelectorCategoria';
import { useCategorias } from './categorias/useCategorias';
import { ELECCION_VACIA, categoriaIdDeEleccion, hayOpcionesCategoria, mensajeEleccion } from './categorias/categorias-logica';

interface Props {
  bancas: Banca[];
  onClose: () => void;
  onCreado: () => void;
  /** Tasas Binance y BCV ya cargadas por la pantalla (para el equivalente en USD de los montos en Bs). */
  tasasUsd: EstadoTasasUsd;
}

type Tipo = 'ingreso' | 'egreso' | 'transferencia';
interface Entidad { id: string; nombre: string; activo: boolean; fotos?: string[] }

/** Fuentes de tasa disponibles para sugerir el monto destino en una
 *  transferencia entre bancas de monedas distintas (USD↔Bs). */
const FUENTES_TASA: { key: FuenteTasaKey; label: string }[] = [
  { key: 'bcv', label: 'BCV' },
  { key: 'binance', label: 'Binance' },
];

function CrearMovimientoModal({ bancas: todasLasBancas, onClose, onCreado, tasasUsd }: Props) {
  // Solo se ofrecen cuentas donde se puede registrar; las de solo consulta se ven en la tabla pero no aquí.
  const bancas = bancasEditables(todasLasBancas);
  const { usuario } = useAuth();
  // Sin valores predeterminados: tipo y cuenta/caja los elige la persona (obligatorios al guardar).
  const [tipo, setTipo] = useState<Tipo | ''>('');
  const [bancaId, setBancaId] = useState('');
  const [bancaDestinoId, setBancaDestinoId] = useState('');
  const [monto, setMonto] = useState('');
  const [montoDestino, setMontoDestino] = useState('');
  const [montoDestinoTocado, setMontoDestinoTocado] = useState(false);
  const [tasaFuente, setTasaFuente] = useState<FuenteTasaKey>('bcv');
  const [tasas, setTasas] = useState<Partial<Record<FuenteTasaKey, number>>>({});
  const [descripcion, setDescripcion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fecha, setFecha] = useState(hoyNegocio());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comprobantes, setComprobantes] = useState<FotoLocal[]>([]);
  const mesa = useTransferenciaMesa();
  // Categoría (solo ingreso/egreso): sin valor por defecto. El selector se ve siempre; si no hay categorías queda deshabilitado y no se exige.
  const { categorias } = useCategorias();
  const [eleccionCategoria, setEleccionCategoria] = useState(ELECCION_VACIA);
  const [errorCategoria, setErrorCategoria] = useState<string | null>(null);
  const comision = useComisionDisponible();
  // Un id por apertura del formulario: un doble clic o reintento con el mismo id no registra dos veces (el servidor lo deduplica).
  const [idIntento] = useState(() => crypto.randomUUID());
  // Sin valor por defecto: en una salida desde una cuenta en Bs hay que elegir Sí o No.
  const [opcionComision, setOpcionComision] = useState<OpcionComision>('');

  const agregarComprobantes = (files: File[]) => {
    const { validos, errores } = filtrarComprobantes(files, comprobantes.length);
    setError(errores.length > 0 ? errores.join(' ') : null);
    setComprobantes(prev => [...prev, ...validos.map(fotoLocalDeFile)]);
  };
  const quitarComprobante = (idx: number) => setComprobantes(prev => prev.filter((_, i) => i !== idx));

  // Atribución opcional a proveedor (egreso = pago) o cliente (ingreso = cobro)
  const [proveedores, setProveedores] = useState<Entidad[]>([]);
  const [clientes, setClientes] = useState<Entidad[]>([]);
  const [entidadId, setEntidadId] = useState('');
  const [mostrarSelectorEntidad, setMostrarSelectorEntidad] = useState(false);

  useEffect(() => {
    obtenerProveedores().then(lista => setProveedores(lista.filter(p => p.activo)));
    obtenerClientes().then(lista => setClientes(lista.filter(c => c.activo)));
  }, []);

  // Al cambiar de tipo, se limpia la atribución (proveedor↔cliente no se mezclan)
  // y la selección de banca destino (solo aplica a transferencia).
  const cambiarTipo = (nuevo: Tipo) => {
    setTipo(nuevo);
    setEntidadId('');
    setBancaDestinoId('');
    setMontoDestinoTocado(false);
    setOpcionComision('');
    setEleccionCategoria(ELECCION_VACIA);
    setErrorCategoria(null);
    mesa.reiniciar();
  };

  const bancaActual = bancas.find(b => b.id === bancaId);
  const bancaDestino = bancas.find(b => b.id === bancaDestinoId);
  const bancasDestinoDisponibles = bancas.filter(b => b.id !== bancaId);
  const montoNum = parseFloat(monto) || 0;
  const mostrarCategoria = (tipo === 'ingreso' || tipo === 'egreso') && hayOpcionesCategoria(categorias, tipo);
  const monedasDistintas = tipo === 'transferencia' && !!bancaActual && !!bancaDestino && bancaActual.moneda !== bancaDestino.moneda;
  const ofertaComision = { disponible: comision.disponible, tipo, moneda: bancaActual?.moneda ?? '', mesaActiva: mesa.activa };
  const comisionOfrecida = ofrecerComision(ofertaComision);
  const avisoMesaSinComision = mostrarAvisoMesaSinComision(ofertaComision);
  // Mientras no se sepa si la comisión aplica (cargando o error) no se puede registrar una salida desde Bs.
  const bloqueoComision = bloqueoPorComision({ estado: comision.estado, tipo, moneda: ofertaComision.moneda, mesaActiva: mesa.activa });
  const planComision = planDeComision({
    ofrecida: comisionOfrecida, tipo: tipo || 'egreso', moneda: bancaActual?.moneda ?? '', monto: montoNum, opcion: opcionComision, saldo: bancaActual?.saldo ?? 0,
  });

  // Tasas para sugerir el monto destino, solo cuando hacen falta.
  useEffect(() => {
    if (!monedasDistintas) return;
    FUENTES_TASA.forEach(({ key }) => {
      if (tasas[key] != null) return;
      obtenerTasa(key).then(t => {
        if (t) setTasas(prev => ({ ...prev, [key]: t.tasa }));
      });
    });
  }, [monedasDistintas, tasas]);

  // Monto destino sugerido a partir de la tasa elegida — derivado en cada
  // render, no vive en el estado, para no disparar setState desde un efecto.
  // Mientras el usuario no lo edite a mano, el campo muestra este valor.
  const tasaElegida = tasas[tasaFuente];
  const montoDestinoSugerido = monedasDistintas && tasaElegida && montoNum
    ? (bancaActual!.moneda === 'USD' ? montoNum * tasaElegida : montoNum / tasaElegida)
    : null;
  const montoDestinoMostrado = montoDestinoTocado
    ? montoDestino
    : (montoDestinoSugerido != null ? montoDestinoSugerido.toFixed(2) : '');
  const montoDestinoNum = parseFloat(montoDestinoMostrado) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const problema = validarMovimiento({
      tipo, banca: bancaActual, monto: montoNum, bloqueoComision, planComision,
      categoriaFalta: mostrarCategoria ? mensajeEleccion(eleccionCategoria) : null,
      destino: bancaDestino, monedasDistintas, montoDestino: montoDestinoNum, mesa: { activa: mesa.activa, form: mesa.form },
    });
    if (problema) {
      if (problema.campo === 'categoria') setErrorCategoria(problema.mensaje);
      else setError(problema.mensaje);
      return;
    }
    // validarMovimiento garantiza tipo y cuenta de origen elegidos.
    if (!tipo || !bancaActual) return;

    setGuardando(true);
    const comprobantesUrls = await subirFotosLocal(comprobantes, subirComprobantePago);
    if (!comprobantesUrls) {
      setGuardando(false);
      setError('No se pudo subir el comprobante. Prueba de nuevo o registra el movimiento sin él.');
      return;
    }
    if (tipo === 'transferencia' && mesa.activa) {
      const r = await crearTransferenciaMesa(cuerpoTransferenciaMesa(mesa.form, {
        bancaId, bancaDestinoId, monto: montoNum, montoDestino: monedasDistintas ? montoDestinoNum : null,
        descripcion, referencia, fecha, comprobantes: comprobantesUrls,
        monedaOrigen: bancaActual.moneda, monedaDestino: bancaDestino?.moneda ?? bancaActual.moneda, clientRequestId: idIntento,
      }));
      setGuardando(false);
      if ('error' in r) setError(r.error);
      else onCreado();
      return;
    }
    const result = await registrarMovimiento({
      tipo,
      bancaId,
      bancaDestinoId: tipo === 'transferencia' ? bancaDestinoId : null,
      monto: montoNum,
      montoDestino: monedasDistintas ? montoDestinoNum : null,
      moneda: bancaActual.moneda,
      descripcion: descripcion.trim(),
      referencia: referencia.trim(),
      fecha,
      registradoPor: usuario?.id ?? '',
      proveedorId: tipo === 'egreso' ? entidadId || null : null,
      clienteId: tipo === 'ingreso' ? entidadId || null : null,
      comprobantes: comprobantesUrls,
      categoriaId: mostrarCategoria ? categoriaIdDeEleccion(eleccionCategoria) : null,
      ...(comisionOfrecida ? { llevaComision: llevaDeOpcion(opcionComision) === true } : {}),
      clientRequestId: idIntento,
    });
    setGuardando(false);

    if ('error' in result) {
      setError(result.error);
    } else {
      onCreado();
    }
  };

  const inputClass = "w-full px-3 py-2.5 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Nuevo movimiento">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-surface">
          <h2 className="text-lg font-bold text-text-primary">Nuevo movimiento</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded text-text-muted hover:text-text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Selector de tipo */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">Tipo de movimiento</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => cambiarTipo('ingreso')}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg border-2 text-xs font-medium transition-all ${
                  tipo === 'ingreso'
                    ? 'border-brand-600 bg-brand-50 text-brand-800'
                    : 'border-border text-text-secondary hover:bg-surface-alt'
                }`}
              >
                <ArrowDownLeft size={16} />
                Ingreso
              </button>
              <button
                type="button"
                onClick={() => cambiarTipo('egreso')}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg border-2 text-xs font-medium transition-all ${
                  tipo === 'egreso'
                    ? 'border-text-primary bg-surface-alt text-text-primary'
                    : 'border-border text-text-secondary hover:bg-surface-alt'
                }`}
              >
                <ArrowUpRight size={16} />
                Egreso
              </button>
              <button
                type="button"
                onClick={() => cambiarTipo('transferencia')}
                className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg border-2 text-xs font-medium transition-all ${
                  tipo === 'transferencia'
                    ? 'border-brand-600 bg-brand-50 text-brand-800'
                    : 'border-border text-text-secondary hover:bg-surface-alt'
                }`}
              >
                <ArrowLeftRight size={16} />
                Transferencia
              </button>
            </div>
          </div>

          {/* Banca origen */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {tipo === '' ? 'Cuenta o caja' : `Banca ${tipo === 'ingreso' ? 'destino' : tipo === 'egreso' ? 'origen' : 'de origen'}`}
            </label>
            <SelectorBanca
              bancas={bancas}
              valor={bancaId}
              ariaLabel="Cuenta o caja de origen"
              onChange={id => {
                setBancaId(id);
                if (bancaDestinoId === id) setBancaDestinoId('');
                setOpcionComision('');
              }}
            />
          </div>

          {/* Banca destino — solo transferencia */}
          {tipo === 'transferencia' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Banca de destino</label>
              <SelectorBanca
                bancas={bancasDestinoDisponibles}
                valor={bancaDestinoId}
                titulo="Elegir cuenta o caja de destino"
                ariaLabel="Cuenta o caja de destino"
                onChange={id => { setBancaDestinoId(id); setMontoDestinoTocado(false); }}
              />
            </div>
          )}

          {/* Monto (origen) */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              {tipo === 'transferencia' ? 'Monto a debitar' : 'Monto'}{' '}
              {bancaActual && <span className="text-text-muted">({bancaActual.moneda})</span>}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                {bancaActual?.moneda === 'USD' ? '$' : 'Bs'}
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={monto}
                onChange={e => setMonto(e.target.value)}
                className={`${inputClass} pl-9`}
                placeholder="0.00"
              />
            </div>
            {(tipo === 'egreso' || tipo === 'transferencia') && bancaActual && montoNum > bancaActual.saldo && (
              <p className="text-xs text-red-500 mt-1">Excede el saldo disponible</p>
            )}
            {bancaActual?.moneda === 'VES' && <EquivalenteUsd montoBs={montoNum} estado={tasasUsd} />}
          </div>

          {/* Comisión bancaria — salidas desde una cuenta en Bs (obligatorio elegir Sí o No) */}
          {comisionOfrecida && (
            <ComisionBancariaCampo opcion={opcionComision} onCambiar={setOpcionComision} plan={planComision} monto={montoNum} />
          )}
          {bloqueoComision && (
            <AvisoComisionNoVerificada mensaje={bloqueoComision} enError={comision.estado === 'error'} onReintentar={comision.reintentar} />
          )}
          {avisoMesaSinComision && <AvisoMesaSinComisionBancaria />}

          {/* Monto destino + tasa — solo transferencia entre monedas distintas */}
          {monedasDistintas && (
            <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Tasa a usar (sugerencia)</label>
                <div className="flex rounded-lg overflow-hidden border border-border text-xs w-fit">
                  {FUENTES_TASA.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setTasaFuente(key); setMontoDestinoTocado(false); }}
                      className={`px-3 py-1.5 ${tasaFuente === key ? 'bg-brand-600 text-white' : 'bg-surface text-text-secondary'}`}
                    >
                      {label}{tasas[key] != null ? ` (${tasas[key]!.toLocaleString('es-VE', { maximumFractionDigits: 2 })})` : ''}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Monto que llega a {bancaDestino?.nombre ?? 'la banca destino'}{' '}
                  <span className="text-text-muted">({bancaDestino?.moneda})</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                    {bancaDestino?.moneda === 'USD' ? '$' : 'Bs'}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={montoDestinoMostrado}
                    onChange={e => { setMontoDestino(e.target.value); setMontoDestinoTocado(true); }}
                    className={`${inputClass} pl-9`}
                    placeholder="0.00"
                  />
                </div>
                {bancaDestino?.moneda === 'VES' && <EquivalenteUsd montoBs={montoDestinoNum} estado={tasasUsd} />}
                <p className="text-xs text-text-muted mt-1">
                  Editable — ajústalo si negociaste una tasa distinta a la sugerida.
                </p>
              </div>
            </div>
          )}

          {/* Mesa de cambio — solo transferencia y solo si se tiene permiso en la mesa */}
          {tipo === 'transferencia' && mesa.disponible && (
            <MesaCambioCampos
              mesa={mesa}
              bancaOrigen={bancaActual}
              bancaDestino={bancaDestino}
              monto={montoNum}
              montoDestino={monedasDistintas ? montoDestinoNum : null}
            />
          )}

          {/* Fecha */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Fecha</label>
            <input
              type="date"
              required
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Descripción</label>
            <input
              type="text"
              required
              maxLength={200}
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              className={inputClass}
              placeholder={
                tipo === 'ingreso' ? 'Ej: Depósito mensual' :
                tipo === 'egreso' ? 'Ej: Pago a proveedor X' :
                'Ej: Traspaso a cuenta USD'
              }
            />
          </div>

          {/* Referencia */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Referencia <span className="text-text-muted">(opcional)</span>
            </label>
            <input
              type="text"
              maxLength={50}
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
              className={inputClass}
              placeholder="Ej: OC-2026-001, TRF-432"
            />
          </div>

          {/* Atribución a proveedor (pago) o cliente (cobro) — no aplica a transferencias entre cuentas propias */}
          {tipo !== 'transferencia' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                {tipo === 'egreso' ? 'Pago a proveedor' : 'Cobro de cliente'}{' '}
                <span className="text-text-muted">(opcional)</span>
              </label>
              <button
                type="button"
                onClick={() => setMostrarSelectorEntidad(true)}
                className={`${inputClass} flex items-center justify-between gap-2 text-left`}
              >
                <span className={entidadId ? 'text-text-primary truncate' : 'text-text-muted'}>
                  {(tipo === 'egreso' ? proveedores : clientes).find(e => e.id === entidadId)?.nombre ?? '— Sin atribuir —'}
                </span>
                <ChevronDown size={14} className="text-text-muted shrink-0" />
              </button>
              <p className="text-xs text-text-muted mt-1">
                Si lo atribuyes, aparece como {tipo === 'egreso' ? 'pago' : 'cobro'} en su estado de cuenta.
              </p>
            </div>
          )}

          {/* Categoría y subcategoría — solo ingreso y egreso */}
          {(tipo === 'ingreso' || tipo === 'egreso') && (
            <SelectorCategoria
              tipo={tipo}
              categorias={categorias}
              valor={eleccionCategoria}
              onChange={e => { setEleccionCategoria(e); setErrorCategoria(null); }}
              error={errorCategoria}
            />
          )}

          <FotoMultiplePicker
            fotos={comprobantes}
            onAgregar={agregarComprobantes}
            onQuitar={quitarComprobante}
            label="Imagen del comprobante (opcional)"
          />

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando || bloqueoComision !== null}
              className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {guardando ? 'Registrando...' : mesa.activa ? 'Registrar transferencia en proceso' : `Registrar ${tipo || 'movimiento'}`}
            </button>
          </div>
        </form>
      </div>
      {mostrarSelectorEntidad && (
        <SeleccionarEntidadModal
          titulo={tipo === 'egreso' ? 'Elegir proveedor' : 'Elegir cliente'}
          entidades={tipo === 'egreso' ? proveedores : clientes}
          onClose={() => setMostrarSelectorEntidad(false)}
          onSeleccionar={id => { setEntidadId(id); setMostrarSelectorEntidad(false); }}
        />
      )}
    </div>
  );
}

export default CrearMovimientoModal;
