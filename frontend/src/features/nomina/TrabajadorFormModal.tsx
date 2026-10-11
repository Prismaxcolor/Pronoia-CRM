import { useState } from 'react';
import { X } from 'lucide-react';
import { actualizarTrabajador, crearTrabajador, type TrabajadorInput } from '../../services/nomina-service';
import { useToast } from '../../hooks/use-toast-context';
import { useCerrarConEscape } from '../../hooks/use-cerrar-con-escape';
import { ETIQUETA_TIPO_TRABAJADOR, nombreCompleto, type TipoTrabajador, type Trabajador } from '@shared/types/nomina';
import { leerNumero } from './nomina-editor';

interface Props {
  /** Tipo con el que se crea un trabajador nuevo (la pestaña desde la que se abrió). */
  tipo: TipoTrabajador;
  /** Si se pasa, modo "editar". Si no, modo "crear". */
  trabajador?: Trabajador | null;
  onClose: () => void;
  onGuardado: () => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

interface CampoProps {
  id: string;
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  requerido?: boolean;
  tipo?: string;
  max?: number;
  ayuda?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel';
}

function Campo({ id, etiqueta, valor, onCambio, requerido, tipo = 'text', max = 120, ayuda, inputMode }: CampoProps) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{etiqueta}{requerido ? ' *' : ''}</label>
      <input
        id={id} type={tipo} required={requerido} maxLength={max} value={valor} inputMode={inputMode}
        onChange={e => onCambio(e.target.value)} className={inputClass} aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        autoComplete="off"
      />
      {ayuda && <p id={`${id}-ayuda`} className="mt-1 text-xs text-text-muted">{ayuda}</p>}
    </div>
  );
}

const vacioANull = (v: string): string | null => v.trim() || null;

function TrabajadorFormModal({ tipo, trabajador, onClose, onGuardado }: Props) {
  const toast = useToast();
  const editando = !!trabajador;
  const [f, setF] = useState({
    tipo: trabajador?.tipo ?? tipo,
    nombres: trabajador?.nombres ?? '',
    apellidos: trabajador?.apellidos ?? '',
    cedula: trabajador?.cedula ?? '',
    rif: trabajador?.rif ?? '',
    telefono: trabajador?.telefono ?? '',
    direccion: trabajador?.direccion ?? '',
    contactoEmergenciaNombre: trabajador?.contactoEmergenciaNombre ?? '',
    contactoEmergenciaTelefono: trabajador?.contactoEmergenciaTelefono ?? '',
    pagoMovilBanco: trabajador?.pagoMovilBanco ?? '',
    pagoMovilTelefono: trabajador?.pagoMovilTelefono ?? '',
    pagoMovilCedula: trabajador?.pagoMovilCedula ?? '',
    binanceCorreoId: trabajador?.binanceCorreoId ?? '',
    pagoDiarioUsd: trabajador ? String(trabajador.pagoDiarioUsd) : '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useCerrarConEscape(onClose, guardando);
  const poner = (campo: keyof typeof f) => (v: string) => setF(prev => ({ ...prev, [campo]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const pagoDiarioUsd = f.pagoDiarioUsd.trim() ? leerNumero(f.pagoDiarioUsd) : 0;
    if (pagoDiarioUsd === null || pagoDiarioUsd < 0) { setError('El pago por día debe ser un número igual o mayor a 0.'); return; }
    const datos: TrabajadorInput = {
      tipo: f.tipo, nombres: f.nombres.trim(), apellidos: f.apellidos.trim(), cedula: f.cedula.trim(),
      rif: vacioANull(f.rif), telefono: vacioANull(f.telefono), direccion: vacioANull(f.direccion),
      contactoEmergenciaNombre: vacioANull(f.contactoEmergenciaNombre), contactoEmergenciaTelefono: vacioANull(f.contactoEmergenciaTelefono),
      pagoMovilBanco: vacioANull(f.pagoMovilBanco), pagoMovilTelefono: vacioANull(f.pagoMovilTelefono),
      pagoMovilCedula: vacioANull(f.pagoMovilCedula), binanceCorreoId: vacioANull(f.binanceCorreoId), pagoDiarioUsd,
    };
    setGuardando(true);
    const r = trabajador ? await actualizarTrabajador(trabajador.id, datos) : await crearTrabajador(datos);
    setGuardando(false);
    if ('error' in r) { setError(r.error); return; }
    toast.exito(`${nombreCompleto(r.trabajador)} ${editando ? 'actualizado' : 'agregado'}.`);
    onGuardado();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="trabajador-titulo">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 id="trabajador-titulo" className="text-lg font-bold text-text-primary">
            {editando ? 'Editar trabajador' : `Nuevo trabajador · ${ETIQUETA_TIPO_TRABAJADOR[f.tipo]}`}
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-text-muted hover:text-text-primary transition-colors"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <p className="rounded-lg bg-surface-alt p-3 text-xs text-text-secondary">
            Son datos personales: solo los ve quien tenga el permiso de Nómina. No se incluyen en avisos ni en otras pantallas.
          </p>
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-primary mb-2">Datos personales</legend>
            <div>
              <label htmlFor="trab-tipo" className={labelClass}>Tipo de personal *</label>
              <select id="trab-tipo" value={f.tipo} onChange={e => setF(prev => ({ ...prev, tipo: e.target.value as TipoTrabajador }))} className={inputClass}>
                <option value="ADMINISTRATIVO">{ETIQUETA_TIPO_TRABAJADOR.ADMINISTRATIVO}</option>
                <option value="OPERATIVO">{ETIQUETA_TIPO_TRABAJADOR.OPERATIVO}</option>
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo id="trab-nombres" etiqueta="Nombres" requerido max={80} valor={f.nombres} onCambio={poner('nombres')} />
              <Campo id="trab-apellidos" etiqueta="Apellidos" requerido max={80} valor={f.apellidos} onCambio={poner('apellidos')} />
              <Campo id="trab-cedula" etiqueta="Cédula" requerido max={20} valor={f.cedula} onCambio={poner('cedula')} ayuda="Ej. V-12345678" />
              <Campo id="trab-rif" etiqueta="RIF" max={20} valor={f.rif} onCambio={poner('rif')} ayuda="Ej. V-12345678-9" />
              <Campo id="trab-telefono" etiqueta="Teléfono" tipo="tel" inputMode="tel" max={30} valor={f.telefono} onCambio={poner('telefono')} />
              <Campo id="trab-pago" etiqueta="Pago por día (USD)" inputMode="decimal" max={12} valor={f.pagoDiarioUsd} onCambio={poner('pagoDiarioUsd')} ayuda="Es el monto base de la nómina; se puede cambiar en cada semana." />
            </div>
            <div>
              <label htmlFor="trab-direccion" className={labelClass}>Dirección</label>
              <textarea id="trab-direccion" rows={2} maxLength={300} value={f.direccion} onChange={e => poner('direccion')(e.target.value)} className={inputClass} />
            </div>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-primary mb-2">Contacto de emergencia</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo id="trab-emerg-nombre" etiqueta="Nombre y parentesco" valor={f.contactoEmergenciaNombre} onCambio={poner('contactoEmergenciaNombre')} />
              <Campo id="trab-emerg-tel" etiqueta="Teléfono" tipo="tel" inputMode="tel" max={30} valor={f.contactoEmergenciaTelefono} onCambio={poner('contactoEmergenciaTelefono')} />
            </div>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-text-primary mb-2">Datos para pagos</legend>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Campo id="trab-pm-banco" etiqueta="Pago móvil · banco" max={60} valor={f.pagoMovilBanco} onCambio={poner('pagoMovilBanco')} />
              <Campo id="trab-pm-tel" etiqueta="Pago móvil · teléfono" tipo="tel" inputMode="tel" max={30} valor={f.pagoMovilTelefono} onCambio={poner('pagoMovilTelefono')} />
              <Campo id="trab-pm-cedula" etiqueta="Pago móvil · cédula" max={20} valor={f.pagoMovilCedula} onCambio={poner('pagoMovilCedula')} />
            </div>
            <Campo id="trab-binance" etiqueta="Binance · correo o ID" valor={f.binanceCorreoId} onCambio={poner('binanceCorreoId')} ayuda="Si lo llenas, en la nómina se propone pagarle en divisas; si no, en bolívares por pago móvil." />
          </fieldset>
          {error && <p role="alert" className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">Cancelar</button>
            <button type="submit" disabled={guardando} className="flex-1 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Agregar trabajador'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TrabajadorFormModal;
