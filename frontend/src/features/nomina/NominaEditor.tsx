import { useEffect, useMemo, useState } from 'react';
import { Ban, FileDown, Lock, Plus, Save, UserPlus, Wallet } from 'lucide-react';
import { anularNomina, cerrarNomina, guardarNomina } from '../../services/nomina-service';
import { obtenerTasa } from '../../services/tasa-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { BotonAccion, Insignia, useConfirm } from '../../components/ui';
import { formatearFechaHora } from '../../lib/fecha-negocio';
import {
  ETIQUETA_ESTADO_NOMINA, formatearNumeroNomina, type CandidatoNomina, type LineaNomina, type Nomina, type TipoTrabajador,
} from '@shared/types/nomina';
import { lineasNegativas, sumarTotales, type TotalesNomina } from '@shared/types/nomina-calculo';
import MotivoModal from './MotivoModal';
import NominaTabla from './NominaTabla';
import NominaTotales from './NominaTotales';
import PagarNominaModal from './PagarNominaModal';
import PagarTrabajadorModal from './PagarTrabajadorModal';
import PagoTrabajadoresPanel from './PagoTrabajadoresPanel';
import PagoNominaEstado from './PagoNominaEstado';
import { estadoPagoNomina, sePuedePagar } from './nomina-pago';
import { descargarNominaPDF } from './nomina-pdf';
import {
  construirPayload, leerNumero, renglonDeCandidato, renglonDeLinea, renglonesConTotales, totalesDeRenglones, validarRenglones,
  type RenglonEditor,
} from './nomina-editor';

interface Props {
  tipo: TipoTrabajador;
  semana: string;
  nomina: Nomina | null;
  candidatos: CandidatoNomina[];
  /** Totales de la nómina del otro tipo de personal en la misma semana (para el total general), si existe. */
  totalesOtroTipo: TotalesNomina | null;
  onRecargar: () => Promise<void>;
}

const inputClass = 'px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400';
const num = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Fórmulas vigentes, en lenguaje llano (se mantienen en backend/src/utils/nomina-calculo.ts). */
function RotuloFormulas() {
  return (
    <details className="mb-4 rounded-xl border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium text-text-primary">Cómo se calcula cada trabajador</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-text-secondary">
        <li>Cada trabajador tiene <strong>dos sueldos por día</strong>: el de <strong>divisas</strong> (USD, efectivo o Binance) y el de <strong>Bs</strong> (pago móvil). Puede cobrar las dos partes.</li>
        <li>El número del <strong>sueldo en Bs es una referencia en USD</strong>, no bolívares: 8 significa 8 USD por día, que se pagan en bolívares convertidos a la tasa de la nómina (a tasa 40 son 320 Bs por día).</li>
        <li><strong>Total bruto (USD)</strong> = días x sueldo en divisas + días x sueldo en Bs (USD de referencia).</li>
        <li><strong>A pagar en divisas</strong> = días x sueldo en divisas + bonificación extra - descuentos (por trabajo + cuotas de préstamo).</li>
        <li><strong>A pagar en Bs</strong> = (días x sueldo en Bs en USD) x tasa. Los descuentos se cargan primero a divisas; si no alcanzan, el sobrante (en USD) se descuenta de la parte en Bs.</li>
        <li><strong>Total del trabajador (USD)</strong> = a pagar en divisas + valor en USD de la parte en Bs (no cambia con la tasa).</li>
        <li>La tasa es obligatoria cuando algún trabajador tiene sueldo en Bs: usa la del día (Binance al mediodía de Caracas).</li>
      </ul>
    </details>
  );
}

function NominaEditor({ tipo, semana, nomina, candidatos, totalesOtroTipo, onRecargar }: Props) {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const confirmar = useConfirm();
  const [renglones, setRenglones] = useState<RenglonEditor[]>(() => (nomina ? nomina.lineas.map(l => renglonDeLinea(l, candidatos)) : []));
  const [tasa, setTasa] = useState(nomina?.tasaBs == null ? '' : String(nomina.tasaBs));
  const [tasaSugerida, setTasaSugerida] = useState<number | null>(null);
  const [sucio, setSucio] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [pagandoA, setPagandoA] = useState<LineaNomina | null>(null);
  const [elegido, setElegido] = useState('');

  const estado = nomina?.estado ?? null;
  const soloLectura = estado === 'CERRADA' || estado === 'ANULADA';
  const puedeGuardar = !soloLectura && (nomina ? tienePermiso('nomina', 'editar') || tienePermiso('nomina', 'crear') : tienePermiso('nomina', 'crear'));
  const tasaNum = leerNumero(tasa);
  const calculados = useMemo(() => renglonesConTotales(renglones, tasaNum), [renglones, tasaNum]);
  const totales = useMemo(() => totalesDeRenglones(calculados, tasaNum), [calculados, tasaNum]);
  const hayNegativosAhora = useMemo(() => lineasNegativas(calculados.map(r => r.calculo)).length > 0, [calculados]);
  const disponibles = candidatos.filter(c => !renglones.some(r => r.trabajadorId === c.trabajadorId));

  useEffect(() => {
    let vivo = true;
    void obtenerTasa('binance').then(t => { if (vivo) setTasaSugerida(t?.tasa ?? null); });
    return () => { vivo = false; };
  }, []);

  const cambiar = (indice: number, parche: Partial<RenglonEditor>) => {
    setRenglones(prev => prev.map((r, i) => (i === indice ? { ...r, ...parche } : r)));
    setSucio(true);
  };
  const quitar = (indice: number) => { setRenglones(prev => prev.filter((_, i) => i !== indice)); setSucio(true); };
  const agregar = (ids: string[]) => {
    const nuevos = candidatos.filter(c => ids.includes(c.trabajadorId)).map(renglonDeCandidato);
    setRenglones(prev => [...prev, ...nuevos]);
    setElegido('');
    setSucio(true);
  };

  const guardar = async () => {
    const problema = validarRenglones(renglones, tasaNum);
    if (problema) { toast.errorMsg(problema); return; }
    const hayNegativos = lineasNegativas(calculados.map(r => r.calculo)).length > 0;
    if (hayNegativos && !(await confirmar({
      titulo: 'Hay totales negativos',
      mensaje: 'Algún trabajador tiene descuentos mayores a lo que ganó, así que su total a pagar sale negativo. Puedes guardarlo como borrador, pero la nómina NO se podrá cerrar hasta corregir esos montos. ¿Guardar el borrador así?',
      confirmarLabel: 'Guardar solo como borrador', variante: 'warning',
    }))) return;
    setOcupado(true);
    const r = await guardarNomina(construirPayload({ tipo, semana, tasa, version: nomina?.version ?? null, confirmarNegativos: hayNegativos, renglones }));
    setOcupado(false);
    if ('error' in r) { toast.errorMsg(r.error); return; }
    toast.exito('Nómina guardada como borrador.');
    await onRecargar();
  };

  const cerrar = async () => {
    if (!nomina || sucio) return;
    if (hayNegativosAhora) { toast.errorMsg('No se puede cerrar: hay trabajadores con total negativo. Corrige los montos y guarda de nuevo.'); return; }
    if (!(await confirmar({
      titulo: 'Cerrar la nómina',
      mensaje: 'Al cerrarla se descuentan las cuotas de préstamo (bajan los saldos) y ya no se podrá editar; solo anular con un motivo. ¿Cerrar la nómina?',
      confirmarLabel: 'Cerrar nómina', variante: 'warning',
    }))) return;
    setOcupado(true);
    const r = await cerrarNomina(nomina.id);
    setOcupado(false);
    if ('error' in r) { toast.errorMsg(r.error); return; }
    toast.exito(r.yaCerrada ? 'La nómina ya estaba cerrada.' : 'Nómina cerrada.');
    await onRecargar();
  };

  const alPagar = async (yaPagada: boolean, advertencia?: string) => {
    setPagando(false);
    toast.exito(yaPagada ? 'La nómina ya estaba pagada.' : 'Nómina pagada desde el Wallet.');
    if (advertencia) toast.errorMsg(advertencia);
    await onRecargar();
  };

  const alPagarTrabajador = async (yaPagado: boolean, advertencia?: string) => {
    setPagandoA(null);
    toast.exito(yaPagado ? 'El trabajador ya estaba pagado.' : 'Pago registrado en el Wallet.');
    if (advertencia) toast.errorMsg(advertencia);
    await onRecargar();
  };

  const anular = async (motivo: string): Promise<string | undefined> => {
    if (!nomina) return undefined;
    const r = await anularNomina(nomina.id, motivo);
    if ('error' in r) return r.error;
    toast.exito('Nómina anulada.');
    setAnulando(false);
    await onRecargar();
    return undefined;
  };

  const imprimir = async () => {
    if (!nomina || sucio) return;
    setOcupado(true);
    try { await descargarNominaPDF(nomina); } catch { toast.errorMsg('No se pudo generar el PDF.'); }
    setOcupado(false);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="nomina-tasa" className="block text-xs font-medium text-text-secondary mb-1">Tasa del día (Bs por USD, Binance mediodía)</label>
          <input
            id="nomina-tasa" inputMode="decimal" value={tasa} disabled={soloLectura} className={`${inputClass} w-44 tabular-nums`}
            onChange={e => { setTasa(e.target.value); setSucio(true); }}
          />
        </div>
        {!soloLectura && tasaSugerida !== null && tasaNum !== tasaSugerida && (
          <button type="button" onClick={() => { setTasa(String(tasaSugerida)); setSucio(true); }} className="pb-2 text-sm text-brand-700 underline">
            Usar la tasa Binance de hoy ({num(tasaSugerida)})
          </button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {nomina && <Insignia tono={estado === 'CERRADA' ? 'exito' : estado === 'ANULADA' ? 'neutral' : 'aviso'}>{formatearNumeroNomina(nomina.numero)} · {ETIQUETA_ESTADO_NOMINA[nomina.estado]}</Insignia>}
          {nomina && <BotonAccion variante="secundario" icono={<FileDown size={16} />} onClick={() => void imprimir()} disabled={sucio || ocupado}>Imprimir / PDF</BotonAccion>}
        </div>
      </div>
      {soloLectura && nomina && (
        <p role="status" className="mb-4 rounded-lg bg-surface-alt p-3 text-sm text-text-secondary">
          {estado === 'CERRADA'
            ? `Nómina cerrada${nomina.cerradaEn ? ` el ${formatearFechaHora(nomina.cerradaEn)}` : ''}: ya no se puede editar. Si hay un error, anúlala con un motivo y carga otra.${nomina.pagos.length > 0 ? ' Al anularla también se anula su pago en el Wallet.' : ''}`
            : `Nómina anulada${nomina.anuladaMotivo ? `: ${nomina.anuladaMotivo}` : ''}.`}
        </p>
      )}

      {nomina && <PagoNominaEstado nomina={nomina} />}
      {nomina && estado === 'CERRADA' && (
        <PagoTrabajadoresPanel
          nomina={nomina} puedePagar={tienePermiso('nomina', 'editar') && tienePermiso('cochinito', 'crear')} onPagar={setPagandoA}
        />
      )}

      <RotuloFormulas />

      {!soloLectura && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select aria-label="Trabajador a agregar" value={elegido} onChange={e => setElegido(e.target.value)} className={inputClass} disabled={disponibles.length === 0}>
            <option value="">{disponibles.length === 0 ? 'No quedan trabajadores por agregar' : 'Elige un trabajador…'}</option>
            {disponibles.map(c => <option key={c.trabajadorId} value={c.trabajadorId}>{c.nombre}</option>)}
          </select>
          <BotonAccion variante="secundario" icono={<Plus size={16} />} disabled={!elegido} onClick={() => agregar([elegido])}>Agregar</BotonAccion>
          <BotonAccion variante="secundario" icono={<UserPlus size={16} />} disabled={disponibles.length === 0} onClick={() => agregar(disponibles.map(c => c.trabajadorId))}>Agregar a todos</BotonAccion>
        </div>
      )}

      {renglones.length === 0 ? (
        <p className="mb-6 rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-secondary">
          {candidatos.length === 0
            ? 'No hay personal activo de este tipo. Regístralo en su pestaña para poder cargar la nómina.'
            : 'Esta semana aún no tiene trabajadores. Usa “Agregar a todos” o elige uno por uno.'}
        </p>
      ) : (
        <div className="mb-6"><NominaTabla renglones={calculados} soloLectura={soloLectura} onCambiar={cambiar} onQuitar={quitar} /></div>
      )}

      <NominaTotales titulo="Totales de esta nómina" queEstasViendo="Lo que se debe pagar al personal de este tipo esta semana, separando la parte en divisas y la parte en bolívares." totales={totales} />
      {totalesOtroTipo && (
        <NominaTotales
          titulo="Total general de la semana"
          queEstasViendo="Esta nómina más la del otro tipo de personal de la misma semana (la otra, tal como está guardada)."
          totales={sumarTotales([totales, totalesOtroTipo])}
        />
      )}

      <div className="flex flex-wrap gap-3">
        {puedeGuardar && <BotonAccion icono={<Save size={16} />} onClick={() => void guardar()} disabled={ocupado || (!sucio && !!nomina)}>Guardar borrador</BotonAccion>}
        {nomina && estado === 'BORRADOR' && tienePermiso('nomina', 'editar') && (
          <BotonAccion variante="secundario" icono={<Lock size={16} />} onClick={() => void cerrar()} disabled={ocupado || sucio || hayNegativosAhora}>Cerrar nómina</BotonAccion>
        )}
        {nomina && sePuedePagar(nomina) && tienePermiso('nomina', 'editar') && tienePermiso('cochinito', 'crear') && (
          <BotonAccion icono={<Wallet size={16} />} onClick={() => setPagando(true)} disabled={ocupado || sucio}>Pagar toda la nómina desde Wallet</BotonAccion>
        )}
        {nomina && estado !== 'ANULADA' && tienePermiso('nomina', 'eliminar') && (
          <BotonAccion variante="secundario" icono={<Ban size={16} />} onClick={() => setAnulando(true)} disabled={ocupado}>Anular nómina</BotonAccion>
        )}
        {hayNegativosAhora && estado !== 'CERRADA' && estado !== 'ANULADA' && (
          <p role="status" className="self-center text-xs text-red-700">Hay totales negativos: se pueden guardar como borrador, pero no cerrar la nómina hasta corregirlos.</p>
        )}
        {sucio && nomina && estado === 'BORRADOR' && <p className="self-center text-xs text-text-secondary">Hay cambios sin guardar: guarda antes de cerrar o imprimir.</p>}
      </div>

      {pagando && nomina && <PagarNominaModal nomina={nomina} onClose={() => setPagando(false)} onPagada={alPagar} />}
      {pagandoA && nomina && <PagarTrabajadorModal nomina={nomina} linea={pagandoA} onClose={() => setPagandoA(null)} onPagado={alPagarTrabajador} />}
      {anulando && nomina && (
        <MotivoModal
          titulo={`Anular ${formatearNumeroNomina(nomina.numero)}`}
          descripcion={estado === 'CERRADA'
            ? `Se devuelven a los préstamos las cuotas que esta nómina descontó${estadoPagoNomina(nomina.pagos) === 'pagada' ? ' y se anulan sus egresos en el Wallet (el dinero vuelve a las cuentas)' : ''}. Queda en el historial como anulada y podrás cargar otra para esa semana.`
            : 'El borrador queda como anulado y podrás cargar otro para esa semana.'}
          etiquetaConfirmar="Anular nómina" onConfirmar={anular} onClose={() => setAnulando(false)}
        />
      )}
      <p className="mt-6 text-xs text-text-muted">El cálculo no mueve dinero: una nómina cerrada se paga con el botón «Pagar» de cada trabajador (o con «Pagar toda la nómina desde Wallet»), que registra el egreso en la cuenta que elijas. No se pueden mezclar las dos formas.</p>
    </div>
  );
}

export default NominaEditor;
