import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { obtenerLotes, crearLote, actualizarLote } from '../../services/lote-service';
import { obtenerProductos } from '../../services/producto-service';
import { obtenerDetallePantalla } from '../../services/inventario-pantalla-service';
import { subirFotoLote } from '../../services/storage-service';
import { fotoLocalDeFile, subirFotosLocal, type FotoLocal } from '../../lib/foto-picker';
import FotoMultiplePicker from '../../components/FotoMultiplePicker';
import LoteFormModal from './LoteFormModal';
import LoteDetalle from './LoteDetalle';
import LotesTabla from './LotesTabla';
import { BloqueFases, KpisLotesGrilla } from './LotesResumen';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import { Bloque, BotonAccion, FiltrosBarra, SkeletonBloque, SkeletonKpis, useFiltrosUrl } from '../../components/ui';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import {
  fasePorLote, filtrarLotes, kgPorFase, kpisLotes, unirLotes,
  type EstadoLoteFiltro, type FaseFiltro,
} from '../../lib/almacenes-kpis';
import type { ClaseLote, Lote } from '@shared/types/index.js';
import type { FaseLote } from '@shared/types/inventario-pantalla.js';
import type { Producto } from '@shared/types/index.js';

/** Filtros en la URL. Nombres propios del panel (no chocan con `pestana` ni con los de Traslados). */
const ESQUEMA: EsquemaFiltros = {
  campos: {
    fase: { tipo: 'opcion', opciones: ['por_procesar', 'procesado', 'sin_fase'] },
    clase: { tipo: 'opcion', opciones: ['exportacion', 'trabajo', 'otro'] },
    lestado: { tipo: 'opcion', opciones: ['activo', 'inactivo'] },
    lq: { tipo: 'texto' },
    lote: { tipo: 'texto' },
  },
};

const OPCIONES_FASE = [{ valor: 'por_procesar', etiqueta: 'Por procesar' }, { valor: 'procesado', etiqueta: 'Procesado' }, { valor: 'sin_fase', etiqueta: 'Sin fase definida' }];
const OPCIONES_CLASE = [{ valor: 'exportacion', etiqueta: 'Exportación' }, { valor: 'trabajo', etiqueta: 'Trabajo interno' }, { valor: 'otro', etiqueta: 'Otro' }];
const OPCIONES_ESTADO = [{ valor: 'activo', etiqueta: 'Activos' }, { valor: 'inactivo', etiqueta: 'Inactivos' }];
/** Filas máximas que acepta el detalle del inventario (de ahí sale la fase de cada lote). */
const FILAS_DETALLE = '2000';

type LecturaFases = { estado: 'cargando' } | { estado: 'ok'; fases: Map<string, FaseLote> } | { estado: 'error'; mensaje: string };

function LotesPanel() {
  const { tienePermiso, usuario } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('productos', 'crear');
  const puedeEditar = tienePermiso('productos', 'editar');
  // Clase del lote: solo superadmin (lo exige el backend).
  const puedeConfigurar = usuario?.rol === 'superadmin';

  const [lotes, setLotes] = useState<Lote[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [lecturaFases, setLecturaFases] = useState<LecturaFases>({ estado: 'cargando' });
  const [cargando, setCargando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [nombre, setNombre] = useState('');
  const [fotosNuevoLote, setFotosNuevoLote] = useState<FotoLocal[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [loteEditando, setLoteEditando] = useState<Lote | null>(null);
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA);
  const detalleRef = useRef<HTMLDivElement>(null);

  const recargar = () => obtenerLotes().then(setLotes).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);
  useEffect(() => { obtenerProductos().then(setProductos); }, []);

  // La fase de cada lote viene del detalle del inventario: se pide aparte para no frenar la lista.
  const [versionFases, setVersionFases] = useState(0);
  useEffect(() => {
    let cancelado = false;
    obtenerDetallePantalla(new URLSearchParams({ limite: FILAS_DETALLE })).then(r => {
      if (cancelado) return;
      setLecturaFases('error' in r ? { estado: 'error', mensaje: r.error } : { estado: 'ok', fases: fasePorLote(r.dato.filas) });
    });
    return () => { cancelado = true; };
  }, [versionFases]);

  const handleCrear = async (e: React.FormEvent) => {
    e.preventDefault();
    const limpio = nombre.trim();
    if (!limpio) return;
    setGuardando(true);
    const urls = await subirFotosLocal(fotosNuevoLote, subirFotoLote);
    if (!urls) { toast.errorMsg('Error al subir una de las fotos.'); setGuardando(false); return; }
    const result = await crearLote(limpio, urls);
    setGuardando(false);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`Lote "${result.lote.nombre}" creado.`);
    setNombre('');
    setFotosNuevoLote([]);
    cargar();
  };

  const toggleActivo = async (l: Lote) => {
    const result = await actualizarLote(l.id, { activo: !l.activo });
    if ('error' in result) { toast.errorMsg(result.error); return; }
    cargar();
  };

  const fases = lecturaFases.estado === 'ok' ? lecturaFases.fases : null;
  const filas = useMemo(() => unirLotes(lotes, productos, fases), [lotes, productos, fases]);
  const fase = typeof filtros.fase === 'string' ? (filtros.fase as FaseFiltro) : undefined;
  const clase = typeof filtros.clase === 'string' ? (filtros.clase as ClaseLote) : undefined;
  const estado = typeof filtros.lestado === 'string' ? (filtros.lestado as EstadoLoteFiltro) : undefined;
  const q = typeof filtros.lq === 'string' ? filtros.lq : undefined;
  const idDetalle = typeof filtros.lote === 'string' ? filtros.lote : undefined;
  const hayFiltros = Boolean(fase || clase || estado || q);
  const visibles = useMemo(() => filtrarLotes(filas, { q, fase, clase, estado }), [filas, q, fase, clase, estado]);
  const kpis = useMemo(() => kpisLotes(filas), [filas]);
  const porFase = useMemo(() => (fases ? kgPorFase(filas.filter(l => l.activo)) : null), [fases, filas]);
  const hayEmbalado = lotes.some(l => l.embalado);
  const loteDetalle = idDetalle ? lotes.find(l => l.id === idDetalle) : undefined;
  const filaDetalle = loteDetalle ? filas.find(f => f.id === loteDetalle.id) : undefined;

  const elegir = useCallback((id: string) => cambiar({ lote: id }), [cambiar]);
  const cerrarDetalle = useCallback(() => cambiar({ lote: undefined }), [cambiar]);
  useEffect(() => {
    if (idDetalle && loteDetalle) detalleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [idDetalle, loteDetalle]);

  const inputClass = 'px-3 py-2 bg-surface border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent';

  if (cargando && lotes.length === 0) {
    return (
      <div aria-busy="true">
        <SkeletonKpis />
        <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando lotes" />
      </div>
    );
  }

  return (
    <div>
      {puedeCrear && (
        <div className="mb-4 flex justify-end">
          <BotonAccion icono={<Plus size={16} />} variante={mostrarForm ? 'secundario' : 'primario'} onClick={() => setMostrarForm(v => !v)}>
            {mostrarForm ? 'Cerrar el formulario' : 'Nuevo lote'}
          </BotonAccion>
        </div>
      )}

      {puedeCrear && mostrarForm && (
        <Bloque titulo="Crear un lote" queEstasViendo="Un lote nuevo empieza vacío y sin fase. Ponle nombre (por ejemplo «Lote 5») y, si quieres, fotos de referencia.">
          <form onSubmit={handleCrear} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="lote-nuevo-nombre" className="mb-1 block text-xs font-medium text-text-secondary">Nuevo lote</label>
                <input
                  id="lote-nuevo-nombre"
                  type="text"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  className={`${inputClass} w-full`}
                  placeholder="Ej. Lote 1"
                />
              </div>
              <button
                type="submit"
                disabled={guardando || !nombre.trim()}
                className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50"
              >
                {guardando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
                Agregar
              </button>
            </div>
            <FotoMultiplePicker
              fotos={fotosNuevoLote}
              onAgregar={files => setFotosNuevoLote(prev => [...prev, ...files.map(fotoLocalDeFile)])}
              onQuitar={idx => setFotosNuevoLote(prev => prev.filter((_, i) => i !== idx))}
              label="Fotos del lote"
            />
          </form>
        </Bloque>
      )}

      <FiltrosBarra
        selectores={[
          { id: 'lotes-fase', etiqueta: 'Fase', valor: fase, opciones: OPCIONES_FASE, onCambiar: v => cambiar({ fase: v }), textoTodas: 'Todas' },
          { id: 'lotes-clase', etiqueta: 'Clase', valor: clase, opciones: OPCIONES_CLASE, onCambiar: v => cambiar({ clase: v }), textoTodas: 'Todas' },
        ]}
        buscador={{ id: 'lotes-buscar', valor: q, onCambiar: v => cambiar({ lq: v }), placeholder: 'Nombre del lote o producto ancla…' }}
        avanzados={[{ id: 'lotes-estado', etiqueta: 'Estado', valor: estado, opciones: OPCIONES_ESTADO, onCambiar: v => cambiar({ lestado: v }), textoTodas: 'Todos' }]}
        onLimpiar={limpiar}
      />

      <section aria-label="Indicadores de lotes" className="mb-8">
        <KpisLotesGrilla
          kpis={kpis}
          hayEmbalado={hayEmbalado}
          lotesExportacion={filas.filter(l => l.activo && l.clase === 'exportacion').length}
          lotesTrabajo={filas.filter(l => l.activo && l.clase === 'trabajo').length}
        />
      </section>

      {lotes.length > 0 && (
        <BloqueFases
          porFase={porFase}
          errorFase={lecturaFases.estado === 'error' ? lecturaFases.mensaje || 'Error de lectura.' : null}
          onReintentar={() => { setLecturaFases({ estado: 'cargando' }); setVersionFases(v => v + 1); }}
        />
      )}

      <Bloque
        titulo="Lotes"
        queEstasViendo="Cada fila es un destino de inventario con su clase, su fase, el producto ancla (★), los kilos que tiene y cuánto lleva embalado. Pulsa el nombre de un lote para ver y gestionar su detalle."
      >
        <LotesTabla
          filas={visibles}
          hayEmbalado={hayEmbalado}
          seleccionado={idDetalle}
          onElegir={elegir}
          hayFiltros={hayFiltros}
          onLimpiar={limpiar}
          puedeCrear={puedeCrear}
          onCrear={() => setMostrarForm(true)}
        />
      </Bloque>

      <div ref={detalleRef}>
        {loteDetalle && filaDetalle && (
          <Bloque titulo={`Detalle de ${loteDetalle.nombre}`} queEstasViendo="Dónde está este lote y con qué composición, qué productos lo anclan, y las acciones de clase y embalado.">
            <LoteDetalle
              lote={loteDetalle}
              fila={filaDetalle}
              puedeEditar={puedeEditar}
              puedeConfigurar={puedeConfigurar}
              onEditar={setLoteEditando}
              onToggleActivo={toggleActivo}
              onCambio={recargar}
              onCerrar={cerrarDetalle}
            />
          </Bloque>
        )}
      </div>

      {loteEditando && (
        <LoteFormModal
          lote={loteEditando}
          onClose={() => setLoteEditando(null)}
          onGuardado={() => { setLoteEditando(null); cargar(); }}
        />
      )}
    </div>
  );
}

export default LotesPanel;
