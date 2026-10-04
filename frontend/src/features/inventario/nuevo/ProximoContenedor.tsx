import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Pencil, PackageCheck } from 'lucide-react';
import { calcularFaltanKg, calcularProgresoPct, formatearCantidadKg, formatearKg, formatearNumero, formatearUsd } from '../../../lib/inventario-nuevo';
import { guardarConfiguracionInventario, type ResumenInventario } from '../../../services/inventario-resumen-service';
import { obtenerLotes } from '../../../services/lote-service';
import MarcarEmbaladoModal from '../../lotes/MarcarEmbaladoModal';
import { useAuth } from '../../../hooks/use-auth-context';
import { useConfirm } from '../../../hooks/use-confirm-context';
import { useToast } from '../../../hooks/use-toast-context';
import type { Lote } from '@shared/types/index.js';
import { BarraProgreso, Bloque } from '../../../components/ui';

const META_MAXIMA_KG = 1_000_000;
const ENLACE_LOTES = '/inventario-legacy?pestana=lotes';

interface Props {
  resumen: ResumenInventario;
  /** Se cambió la meta o se marcó un embalaje: hay que recargar el resumen. */
  onCambio: () => void;
}

function ProximoContenedor({ resumen, onCambio }: Props) {
  const { usuario, tienePermiso } = useAuth();
  const confirmar = useConfirm();
  const toast = useToast();
  const esSuperadmin = usuario?.rol === 'superadmin';
  const puedeEditar = tienePermiso('productos', 'editar');

  const { contenedor } = resumen;
  const sinMeta = !(contenedor.metaKg > 0);
  const faltan = calcularFaltanKg(contenedor.metaKg, contenedor.listoKg);
  const pct = calcularProgresoPct(contenedor.metaKg, contenedor.listoKg);
  const completo = !sinMeta && faltan === 0;

  const [editando, setEditando] = useState(false);
  const [metaTexto, setMetaTexto] = useState('');
  const [errorMeta, setErrorMeta] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cargandoLote, setCargandoLote] = useState(false);
  const [loteModal, setLoteModal] = useState<Lote | null>(null);

  const valorLote = (loteId: string): number | null =>
    resumen.valorOculto ? null : resumen.lotes.items.find(l => l.loteId === loteId)?.valorEstimadoUsd ?? null;

  const abrirEdicion = () => {
    setMetaTexto(String(sinMeta ? '' : contenedor.metaKg));
    setErrorMeta(null);
    setEditando(true);
  };

  const guardarMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    const nueva = Number(metaTexto.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(nueva) || nueva <= 0 || nueva > META_MAXIMA_KG) {
      setErrorMeta(`Escribe una meta en kg mayor a 0 y hasta ${formatearNumero(META_MAXIMA_KG)}.`);
      return;
    }
    const ok = await confirmar({
      titulo: 'Cambiar la meta del contenedor',
      mensaje: `La meta pasará de ${formatearKg(contenedor.metaKg)} a ${formatearKg(nueva)} para todos los usuarios. ¿Continuar?`,
      confirmarLabel: 'Cambiar meta',
    });
    if (!ok) return;
    setGuardando(true);
    setErrorMeta(null);
    const r = await guardarConfiguracionInventario({ metaContenedorKg: nueva });
    setGuardando(false);
    if ('error' in r) { setErrorMeta(r.error); return; }
    toast.exito(`Meta del contenedor: ${formatearKg(r.configuracion.metaContenedorKg)}.`);
    if (r.advertencia) toast.advertencia(r.advertencia);
    setEditando(false);
    onCambio();
  };

  // MarcarEmbaladoModal necesita el Lote completo (stock por almacén, embalado): se pide al elegir.
  const elegirLote = async (loteId: string) => {
    setMenuAbierto(false);
    setCargandoLote(true);
    const lotes = await obtenerLotes();
    setCargandoLote(false);
    const lote = lotes.find(l => l.id === loteId);
    if (!lote) { toast.errorMsg('No se pudo cargar el lote. Intenta de nuevo.'); return; }
    setLoteModal(lote);
  };

  return (
    <Bloque
      titulo="Próximo contenedor"
      queEstasViendo="cuántos kilos de lotes de exportación ya están embalados frente a la meta para completar el contenedor."
      acciones={
        esSuperadmin && !editando ? (
          <button type="button" onClick={abrirEdicion} className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:bg-brand-50">
            <Pencil size={14} aria-hidden="true" /> Editar meta
          </button>
        ) : undefined
      }
    >
      <div className="rounded-xl border border-border bg-surface p-4">
        {editando && (
          <form onSubmit={guardarMeta} className="mb-4 rounded-lg bg-surface-alt p-3">
            <label htmlFor="meta-contenedor" className="mb-1 block text-xs font-medium text-text-secondary">Meta del contenedor (kg)</label>
            <div className="flex flex-wrap items-center gap-2">
              <input id="meta-contenedor" inputMode="decimal" value={metaTexto} onChange={e => setMetaTexto(e.target.value)} autoFocus
                className="w-36 rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
              <button type="submit" disabled={guardando} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
              <button type="button" onClick={() => setEditando(false)} className="px-2 py-2 text-sm text-text-secondary hover:text-text-primary">Cancelar</button>
            </div>
            {errorMeta && <p role="alert" className="mt-2 text-xs text-red-700">{errorMeta}</p>}
          </form>
        )}

        {sinMeta ? (
          <p className="text-sm text-text-secondary">
            Todavía no hay meta para el contenedor.{' '}
            {esSuperadmin
              ? <button type="button" onClick={abrirEdicion} className="font-medium text-brand-700 underline">Define la meta del contenedor →</button>
              : <span>Pídele a un superadmin que la defina.</span>}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-2xl font-bold tabular-nums text-text-primary">
                {formatearCantidadKg(contenedor.listoKg)} <span className="text-base font-medium text-text-secondary">de {formatearKg(contenedor.metaKg)}</span>
              </p>
              <p className="text-sm font-medium tabular-nums text-brand-700">{formatearNumero(pct, 1)} %</p>
            </div>
            <div className="mt-2"><BarraProgreso valor={pct} etiqueta="Progreso hacia la meta del contenedor" /></div>
            <p className="mt-2 text-sm text-text-secondary">
              {completo ? '¡Meta cumplida! El contenedor está completo.' : `Faltan ${formatearKg(faltan)} para completar el contenedor.`}
            </p>
            {contenedor.listoKg <= 0 && (
              <p className="mt-1 text-sm text-text-secondary">
                Aún no hay kg embalados: <Link to={ENLACE_LOTES} className="font-medium text-brand-700 underline">marca los primeros en Lotes →</Link>
              </p>
            )}
          </>
        )}

        {contenedor.porLote.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Desglose por lote de exportación</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-secondary">
                  <th scope="col" className="py-1.5 pr-2 font-medium">Lote</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Embalado</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">En saca</th>
                  <th scope="col" className="py-1.5 pl-2 text-right font-medium"><span className="sm:hidden" title="Valor estimado de venta">Valor est.</span><span className="hidden sm:inline">Valor estimado de venta</span></th>
                </tr>
              </thead>
              <tbody>
                {contenedor.porLote.map(l => {
                  const valor = valorLote(l.loteId);
                  return (
                    <tr key={l.loteId} className="border-b border-border/60 last:border-0">
                      <th scope="row" className="py-2 pr-2 text-left font-medium text-text-primary">{l.nombre}</th>
                      <td className="px-2 py-2 text-right tabular-nums">{formatearKg(l.listoKg)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-text-secondary">{formatearKg(l.enSacaKg)}</td>
                      <td className="py-2 pl-2 text-right tabular-nums text-text-secondary">
                        {resumen.valorOculto ? <span className="text-text-muted">Sin permiso</span> : valor == null ? <span className="text-text-muted" title="Este lote no tiene precio estimado">Sin precio</span> : formatearUsd(valor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-text-secondary">
            No hay lotes de exportación (Lote 1 a 4). <Link to={ENLACE_LOTES} className="font-medium text-brand-700 underline">Clasifícalos en Lotes →</Link>
          </p>
        )}

        {puedeEditar && contenedor.porLote.length > 0 && (
          <div className="relative mt-4">
            <button type="button" aria-expanded={menuAbierto} aria-haspopup="menu" disabled={cargandoLote} onClick={() => setMenuAbierto(v => !v)}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
              <PackageCheck size={16} aria-hidden="true" /> {cargandoLote ? 'Cargando…' : 'Marcar kg como embalados'} <ChevronDown size={14} aria-hidden="true" />
            </button>
            {menuAbierto && (
              <ul role="menu" className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-border bg-surface py-1 shadow-lg">
                <li role="presentation" className="px-3 py-1 text-xs text-text-muted">¿En qué lote?</li>
                {contenedor.porLote.map(l => (
                  <li key={l.loteId} role="none">
                    <button type="button" role="menuitem" onClick={() => elegirLote(l.loteId)} className="w-full px-3 py-2 text-left text-sm hover:bg-brand-50">{l.nombre}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {loteModal && (
        <MarcarEmbaladoModal lote={loteModal} puedeEditar={puedeEditar} onClose={() => setLoteModal(null)} onCambio={onCambio} />
      )}
    </Bloque>
  );
}

export default ProximoContenedor;
