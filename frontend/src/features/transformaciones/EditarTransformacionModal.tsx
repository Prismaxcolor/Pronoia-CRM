import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { editarTransformacion, type EditarSalidaInput, type EditarTransformacionInput } from '../../services/transformacion-service';
import { calcularMermaEdicion, netoDe, validarPesosEdicion } from '../../lib/edicion-pesos-transformacion';
import { etiquetaSalida } from '../../lib/salida-mixta';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import AvisoBorrador from '../../components/AvisoBorrador';
import { difiereEstado, huellaDocumento } from '../../lib/borrador';
import type { Transformacion } from '@shared/types/index.js';
import type { AvisoTransformacion } from '../../services/transformacion-service';

interface Props {
  transformacion: Transformacion;
  /** El servidor exige llave a este usuario (y no es superadmin). */
  requiereLlave: boolean;
  onClose: () => void;
  onGuardada: (t: Transformacion, avisos: AvisoTransformacion[]) => void;
}

const inputClass = 'w-full px-3 py-2 bg-surface-alt border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';
const pesoClass = 'w-24 px-2 py-1.5 bg-surface-alt border border-border rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-400';
const labelClass = 'block text-xs font-medium text-text-secondary mb-1';

const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) : '—');
/** Texto vacío o no numérico = NaN, que la validación rechaza. */
const aNumero = (s: string): number => (s.trim() === '' ? NaN : Number(s));

interface PesosTexto { pesoBruto: string; tara: string }

/** Edita fecha, notas y pesos de la entrada y de cada salida. El neto y la merma se
 *  recalculan en pantalla; el servidor valida de nuevo el balance, el stock y las tomas físicas. */
function EditarTransformacionModal({ transformacion: t, requiereLlave, onClose, onGuardada }: Props) {
  const estadoInicial = () => ({
    fecha: t.fecha,
    notas: t.notas ?? '',
    entrada: { pesoBruto: String(t.pesoBruto), tara: String(t.tara) } as PesosTexto,
    salidas: Object.fromEntries(t.salidas.map(s => [s.id, { pesoBruto: String(s.pesoBruto), tara: String(s.tara) }])) as Record<string, PesosTexto>,
  });
  const [fecha, setFecha] = useState(t.fecha);
  const [notas, setNotas] = useState(t.notas ?? '');
  const [entrada, setEntrada] = useState<PesosTexto>(() => estadoInicial().entrada);
  const [salidas, setSalidas] = useState<Record<string, PesosTexto>>(() => estadoInicial().salidas);
  const [llave, setLlave] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Borrador de la edición (la llave de edición nunca se guarda en el borrador).
  const estadoBorrador = { fecha, notas, entrada, salidas };
  const aplicarEstado = (e: ReturnType<typeof estadoInicial>) => {
    setFecha(e.fecha);
    setNotas(e.notas);
    setEntrada(e.entrada);
    setSalidas(e.salidas);
  };
  const huellaTransformacion = useMemo(() => huellaDocumento(t), [t]);
  const borrador = useBorradorPersistente<typeof estadoBorrador>({
    formulario: 'transformacion-edicion',
    docId: t.id,
    version: 1,
    // Si la transformación cambió en el servidor desde que se guardó el borrador, este se descarta con aviso.
    huellaBase: huellaTransformacion,
    estado: estadoBorrador,
    hayCambios: difiereEstado(estadoBorrador, estadoInicial()),
    aplicar: d => {
      const base = estadoInicial();
      aplicarEstado({
        // La fecha de una edición es la del documento: no se restaura una fecha de borrador.
        fecha: base.fecha,
        notas: d.notas ?? base.notas,
        entrada: { ...base.entrada, ...d.entrada },
        // Solo las salidas que siguen existiendo: un borrador viejo no puede inventar filas.
        salidas: Object.fromEntries(Object.entries(base.salidas).map(([id, v]) => [id, { ...v, ...d.salidas?.[id] }])),
      });
    },
    restablecer: () => aplicarEstado(estadoInicial()),
  });
  // Cerrar (X o Cancelar) descarta el borrador guardado.
  const cerrar = () => { borrador.limpiar(); onClose(); };

  const pesosEntrada = { pesoBruto: aNumero(entrada.pesoBruto), tara: aNumero(entrada.tara) };
  const pesosSalidas = t.salidas.map(s => ({ pesoBruto: aNumero(salidas[s.id].pesoBruto), tara: aNumero(salidas[s.id].tara) }));
  const errorPesos = useMemo(
    () => validarPesosEdicion(pesosEntrada, pesosSalidas),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entrada, salidas]
  );
  const resumen = calcularMermaEdicion(pesosEntrada, pesosSalidas);

  const setPesoSalida = (id: string, campo: keyof PesosTexto, valor: string) =>
    setSalidas(prev => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }));

  /** Solo lo que cambió: el servidor ignora el resto y no gasta la llave en vano. */
  const construirCambios = (): EditarTransformacionInput => {
    const cambios: EditarTransformacionInput = {};
    if (fecha !== t.fecha) cambios.fecha = fecha;
    if (notas.trim() !== (t.notas ?? '').trim()) cambios.notas = notas.trim();
    if (pesosEntrada.pesoBruto !== t.pesoBruto) cambios.pesoBruto = pesosEntrada.pesoBruto;
    if (pesosEntrada.tara !== t.tara) cambios.tara = pesosEntrada.tara;
    const salidasCambiadas = t.salidas.flatMap((s, i): EditarSalidaInput[] => {
      const p = pesosSalidas[i];
      const cambio: EditarSalidaInput = { id: s.id };
      if (p.pesoBruto !== s.pesoBruto) cambio.pesoBruto = p.pesoBruto;
      if (p.tara !== s.tara) cambio.tara = p.tara;
      return cambio.pesoBruto !== undefined || cambio.tara !== undefined ? [cambio] : [];
    });
    if (salidasCambiadas.length > 0) cambios.salidas = salidasCambiadas;
    return cambios;
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fecha) { setError('La fecha es obligatoria.'); return; }
    if (errorPesos) { setError(errorPesos); return; }
    const cambios = construirCambios();
    if (Object.keys(cambios).length === 0) { setError('No hay cambios para guardar.'); return; }
    if (requiereLlave && !llave.trim()) { setError('Ingresa la llave de edición.'); return; }
    setGuardando(true);
    const res = await editarTransformacion(t.id, { ...cambios, llaveEdicion: requiereLlave ? llave.trim() : undefined });
    setGuardando(false);
    if ('error' in res) { setError(res.error); return; }
    borrador.limpiar();
    onGuardada(res.transformacion, res.avisos ?? []);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 print:hidden">
      <form onSubmit={guardar} className="bg-surface rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Editar transformación {t.codigo ?? ''}</h2>
          <button type="button" onClick={cerrar} className="text-text-muted hover:text-text-primary" title="Cerrar"><X size={18} /></button>
        </div>
        <AvisoBorrador formulario="esta edición" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} />
        <p className="text-xs text-text-muted">
          Se pueden editar la fecha, las notas y los pesos de la entrada y de cada salida. Al cambiar un peso se recalcula el
          inventario; si algún producto o lote quedara en negativo, o hay una toma física abierta, el sistema no guarda nada.
          Las fotos y los materiales no se modifican.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className={inputClass} required />
          </div>
          <div>
            <label className={labelClass}>Notas</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} maxLength={2000} rows={2} className={`${inputClass} resize-none`} />
          </div>
        </div>

        <div className="border border-border rounded-xl p-3">
          <p className="text-sm font-medium text-text-primary mb-2">Entrada — {t.nombreProductoEntrada ?? t.nombreLoteOrigen ?? 'material'}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass}>Peso bruto (kg)</label>
              <input type="number" min="0" step="any" value={entrada.pesoBruto} onChange={e => setEntrada(p => ({ ...p, pesoBruto: e.target.value }))} className={pesoClass} aria-label="Peso bruto de entrada" />
            </div>
            <div>
              <label className={labelClass}>Tara (kg)</label>
              <input type="number" min="0" step="any" value={entrada.tara} onChange={e => setEntrada(p => ({ ...p, tara: e.target.value }))} className={pesoClass} aria-label="Tara de entrada" />
            </div>
            <div className="text-sm pb-1.5">
              <span className="text-text-secondary">Neto: </span>
              <span className="font-semibold text-text-primary">{fmt(resumen.netoEntrada)} kg</span>
            </div>
          </div>
        </div>

        {t.salidas.length > 0 && (
          <div className="border border-border rounded-xl p-3">
            <p className="text-sm font-medium text-text-primary mb-2">Salidas</p>
            <div className="space-y-2">
              {t.salidas.map((s, i) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[10rem] text-sm text-text-secondary truncate">
                    {etiquetaSalida(s)}{s.nombreAlmacen ? ` · ${s.nombreAlmacen}` : ''}
                  </div>
                  <input type="number" min="0" step="any" value={salidas[s.id].pesoBruto} onChange={e => setPesoSalida(s.id, 'pesoBruto', e.target.value)} className={pesoClass} aria-label={`Peso bruto de ${etiquetaSalida(s)}`} />
                  <input type="number" min="0" step="any" value={salidas[s.id].tara} onChange={e => setPesoSalida(s.id, 'tara', e.target.value)} className={pesoClass} aria-label={`Tara de ${etiquetaSalida(s)}`} />
                  <span className="w-24 text-right text-sm font-medium text-text-primary">
                    {fmt(netoDe(pesosSalidas[i].pesoBruto, pesosSalidas[i].tara))} kg
                  </span>
                </div>
              ))}
              <p className="text-xs text-text-muted">Columnas: bruto, tara y neto de cada salida.</p>
            </div>
            <div className="flex justify-between text-sm border-t border-border mt-3 pt-2">
              <span className="text-text-secondary">Total salidas: <span className="font-medium text-text-primary">{fmt(resumen.totalSalidas)} kg</span></span>
              <span className="text-text-secondary">Merma: <span className="font-medium text-text-primary">{fmt(resumen.merma)} kg</span></span>
            </div>
          </div>
        )}

        {errorPesos && <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">{errorPesos}</p>}

        {requiereLlave && (
          <div>
            <label className={labelClass}>Llave de edición</label>
            <input
              type="text" value={llave} onChange={e => setLlave(e.target.value)} required autoComplete="off"
              className={`${inputClass} font-mono uppercase tracking-wider`}
              placeholder="Código entregado por el administrador"
            />
            <p className="text-xs text-text-muted mt-1">Pídesela a un administrador. Es de un solo uso.</p>
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button type="button" onClick={cerrar} className="flex-1 py-2.5 border border-border rounded-lg text-sm text-text-secondary hover:bg-surface-alt transition-colors">
            Cancelar
          </button>
          <button type="submit" disabled={guardando || !!errorPesos} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
            {guardando ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default EditarTransformacionModal;
