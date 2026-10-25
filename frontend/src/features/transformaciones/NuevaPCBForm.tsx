import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import type { Almacen, Lote, Tara } from '@shared/types/index.js';
import { crearTransformacionF4 } from '../../services/transformacion-cola';
import { useToast } from '../../hooks/use-toast-context';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { difiereEstado } from '../../lib/borrador';
import { aPesadasConFotos, pesadaEntradaVacia, validarPesadasEntrada, type PesadaEntradaForm } from '../../lib/entrada-pesadas';
import { hoyNegocio } from '../../lib/fecha-negocio';
import AvisoBorrador from '../../components/AvisoBorrador';
import SeleccionarEntidadModal from '../../components/SeleccionarEntidadModal';
import { formatearKgPesaje } from '../pesaje/pesaje-nuevo-logica';
import { revocarFotosDeFilas } from '../pesaje/fotos-preview';
import { useRevocarFotosAlDesmontar } from '../pesaje/use-revocar-fotos';
import PesadasEntradaCampo from './PesadasEntradaCampo';
import AvisoSaneoBorrador from './AvisoSaneoBorrador';
import { StockLoteOrigen } from './LoteOrigenPCBInfo';
import { INPUT_CLASS, LABEL_CLASS } from './clases-formulario';
import { sanearNuevaPCB } from './nueva-transformacion-logica';

interface Props {
  lotes: Lote[];
  almacenes: Almacen[];
  taras: Tara[];
  catalogosListos: boolean;
  onCreada: () => void;
}

/** Formulario: nueva transformación PCB. */
function NuevaPCBForm({ lotes, almacenes, taras, catalogosListos, onCreada }: Props) {
  const toast = useToast();

  const [loteOrigenId, setLoteOrigenId] = useState('');
  const [almacenId, setAlmacenId] = useState('');
  // Varias pesadas de entrada: cada una con bruto, tara y fotos; se suman en el neto de entrada.
  const [pesadas, setPesadas] = useState<PesadaEntradaForm[]>(() => [pesadaEntradaVacia()]);
  const [fecha, setFecha] = useState(hoyNegocio());
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarSelectorLote, setMostrarSelectorLote] = useState(false);
  const [avisoSaneo, setAvisoSaneo] = useState<string | null>(null);
  // Las vistas previas de las fotos se liberan al salir del formulario.
  useRevocarFotosAlDesmontar(pesadas.flatMap(p => p.fotos));

  const estadoBorrador = { loteOrigenId, almacenId, pesadasEntrada: pesadas, fecha, notas };
  const restablecer = () => {
    revocarFotosDeFilas(pesadas);
    setLoteOrigenId(''); setAlmacenId(''); setPesadas([pesadaEntradaVacia()]); setFecha(hoyNegocio()); setNotas(''); setAvisoSaneo(null);
  };
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'transformacion-nueva-pcb',
    version: 1,
    habilitado: catalogosListos,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, { loteOrigenId: '', almacenId: '', pesadasEntrada: [pesadaEntradaVacia()], fecha: hoyNegocio(), notas: '' }),
    aplicar: d => {
      // Lote o almacén que ya no existen (o se desactivó el lote) quedan sin elegir, con aviso.
      const v = sanearNuevaPCB(d, {
        loteIdsActivos: lotes.filter(l => l.activo).map(l => l.id),
        almacenIds: almacenes.map(a => a.id),
        taraIds: taras.map(x => x.id),
        hoy: hoyNegocio(),
      });
      setAvisoSaneo(v.aviso);
      setLoteOrigenId(v.loteOrigenId);
      setAlmacenId(v.almacenId);
      setPesadas(v.pesadas);
      setFecha(v.fecha);
      setNotas(v.notas);
    },
    restablecer,
  });

  const loteOrigen = lotes.find(l => l.id === loteOrigenId);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!loteOrigenId) { setError('Selecciona el lote de origen.'); return; }
    if (!almacenId) { setError('Selecciona de qué almacén sale el lote.'); return; }
    const errorPesadas = validarPesadasEntrada(pesadas, taras);
    if (errorPesadas) { setError(errorPesadas); return; }
    setGuardando(true);
    // En línea sube las fotos y crea; sin conexión guarda todo en el teléfono (cola) con las mismas fotos.
    const result = await crearTransformacionF4(
      'pcb',
      { loteOrigenId, almacenId, fecha, notas: notas.trim() || null },
      aPesadasConFotos(pesadas, taras),
    );
    setGuardando(false);
    if ('error' in result) { setError(result.error); return; }
    if (result.enCola) toast.info('Transformación PCB guardada en el teléfono. Se enviará al volver la conexión.');
    else toast.exito('Transformación PCB iniciada. Complétala cuando tengas las salidas pesadas.');
    borrador.limpiar();
    restablecer();
    onCreada();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <AvisoBorrador className="mb-3" formulario="nueva transformación PCB" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
      <AvisoSaneoBorrador mensaje={avisoSaneo} />
      <div>
        <label className={LABEL_CLASS}>Lote de origen *</label>
        <button type="button" onClick={() => setMostrarSelectorLote(true)}
          className={`${INPUT_CLASS} flex items-center justify-between gap-2 text-left`}>
          <span className={loteOrigenId ? 'text-text-primary truncate' : 'text-text-muted'}>
            {loteOrigen?.nombre ?? '-Selecciona el lote-'}
          </span>
          <ChevronDown size={14} className="text-text-muted shrink-0" />
        </button>
        {loteOrigen && <StockLoteOrigen lote={loteOrigen} />}
      </div>
      <div>
        <label className={LABEL_CLASS}>Almacén de origen *</label>
        <select required value={almacenId} onChange={e => setAlmacenId(e.target.value)} className={INPUT_CLASS}>
          <option value="" disabled>-Selecciona de qué almacén sale el lote-</option>
          {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </div>
      <PesadasEntradaCampo pesadas={pesadas} taras={taras} onCambiar={setPesadas} />
      <div>
        <label className={LABEL_CLASS}>Fecha</label>
        <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className={INPUT_CLASS} />
      </div>
      <div>
        <label className={LABEL_CLASS}>Notas <span className="text-text-muted">(opcional)</span></label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)} className={`${INPUT_CLASS} resize-none`} rows={2} />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button type="submit" disabled={guardando}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
        {guardando ? <><Loader2 size={15} className="animate-spin" /> Registrando...</> : 'Iniciar transformación PCB'}
      </button>
      {mostrarSelectorLote && (
        <SeleccionarEntidadModal
          titulo="Selecciona el lote de origen"
          entidades={lotes.filter(l => l.activo).map(l => ({ id: l.id, nombre: `${l.nombre} — ${formatearKgPesaje(l.stockKg)} kg`, fotos: l.fotos }))}
          onClose={() => setMostrarSelectorLote(false)}
          onSeleccionar={id => { setLoteOrigenId(id); setMostrarSelectorLote(false); }}
        />
      )}
    </form>
  );
}

export default NuevaPCBForm;
