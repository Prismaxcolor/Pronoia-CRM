import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bloque, BotonAccion, EstadoVacio, Insignia, InfoTooltip, SkeletonBloque, formatearNumero, formatearUsd, type Tono } from '../../components/ui';
import AvisoBorrador from '../../components/AvisoBorrador';
import { useAuth } from '../../hooks/use-auth-context';
import { useBorradorPersistente } from '../../hooks/use-borrador-persistente';
import { useToast } from '../../hooks/use-toast-context';
import { actualizarLote, obtenerLotes } from '../../services/lote-service';
import {
  conEdicion, limpiarEdiciones, ordenarLotes, parsearPrecio, precioEfectivo, prepararCambios, sinGuardados,
  textoDePrecio, totalEstimado, valorEstimado, type EdicionesPrecio, type LotePrecio,
} from '../../lib/precios-lotes';
import type { ClaseLote, Lote } from '@shared/types/index.js';
import { formatearFechaHora } from '../../lib/fecha-negocio';

const CLASE: Record<ClaseLote, { etiqueta: string; tono: Tono }> = {
  exportacion: { etiqueta: 'Exportación', tono: 'marca' },
  trabajo: { etiqueta: 'Trabajo interno', tono: 'info' },
  otro: { etiqueta: 'Otro', tono: 'neutral' },
};

const AYUDA = 'Precio por kg al que esperas vender cada lote. Sirve para estimar cuánto valdría lo que tienes en lotes; es aparte del costo y nunca se suma a él.';
const COLUMNAS = 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]';

const aFila = (l: Lote): LotePrecio => ({
  id: l.id, nombre: l.nombre, clase: l.clase ?? 'otro', stockKg: l.stockKg,
  precioEstimadoKg: l.precioEstimadoKg ?? null, actualizadoEn: l.precioEstimadoActualizadoEn ?? null,
});

const fechaCorta = (iso: string) => formatearFechaHora(iso);

interface Props {
  /** Quien llama dice si la pantalla permite editar; el componente además exige el permiso real del backend. */
  puedeEditar: boolean;
  /** Se llama tras guardar al menos un precio, para que Métricas refresque sus cifras. */
  onGuardado?: () => void;
}

/** Bloque "Precio estimado de venta de los lotes". Ver importes: facturacion:ver (el backend omite el precio si no).
 *  Editar: el PATCH /api/lotes/:id exige productos:editar y, para el precio, rol superadmin. */
export default function PreciosLotesEditor({ puedeEditar, onGuardado }: Props) {
  const { tienePermiso, usuario } = useAuth();
  const toast = useToast();
  const puedeVer = tienePermiso('facturacion', 'ver');
  const editable = puedeEditar && puedeVer && usuario?.rol === 'superadmin' && tienePermiso('productos', 'editar');

  const [lotes, setLotes] = useState<LotePrecio[] | null>(null);
  const [error, setError] = useState(false);
  const [ediciones, setEdiciones] = useState<EdicionesPrecio>({});
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError(false);
    try {
      const todos = await obtenerLotes();
      setLotes(ordenarLotes(todos.filter(l => l.activo).map(aFila)));
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    if (!puedeVer) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    void cargar();
  }, [cargar, puedeVer]);

  const filas = useMemo(() => lotes ?? [], [lotes]);
  const vigentes = useMemo(() => limpiarEdiciones(ediciones, filas), [ediciones, filas]);
  const nCambios = Object.keys(vigentes).length;

  const borrador = useBorradorPersistente<EdicionesPrecio>({
    formulario: 'precios-lotes',
    version: 1,
    estado: vigentes,
    hayCambios: nCambios > 0,
    habilitado: editable && lotes !== null,
    aplicar: d => setEdiciones(limpiarEdiciones(d ?? {}, filas)),
    restablecer: () => setEdiciones({}),
  });

  const { total, conPrecio, sinPrecio } = useMemo(() => totalEstimado(filas, vigentes), [filas, vigentes]);
  const { cambios, invalidos } = useMemo(() => prepararCambios(filas, vigentes), [filas, vigentes]);

  const guardar = async () => {
    if (!editable || guardando || invalidos.length > 0 || cambios.length === 0) return;
    setGuardando(true);
    const guardados: string[] = [];
    const fallos: string[] = [];
    for (const c of cambios) {
      const r = await actualizarLote(c.id, { precioEstimadoKg: c.precioEstimadoKg });
      if ('error' in r) fallos.push(`${c.nombre}: ${r.error}`); else guardados.push(c.id);
    }
    setEdiciones(prev => sinGuardados(prev, guardados));
    if (guardados.length > 0) {
      toast.exito(guardados.length === 1 ? 'Precio guardado.' : `${guardados.length} precios guardados.`);
      await cargar();
      onGuardado?.();
    }
    if (fallos.length === 0) borrador.limpiar();
    else toast.errorMsg(`No se pudo guardar: ${fallos.join(' · ')}`);
    setGuardando(false);
  };

  const encabezado = { titulo: 'Precio estimado de venta de los lotes', queEstasViendo: AYUDA };

  if (!puedeVer) {
    return (
      <Bloque {...encabezado}>
        <EstadoVacio mensaje="Sin permiso" descripcion="Los precios y valores en dinero solo los ven las personas con acceso a facturación." />
      </Bloque>
    );
  }
  if (error) {
    return (
      <Bloque {...encabezado}>
        <EstadoVacio mensaje="No se pudieron cargar los lotes." descripcion="Revisa tu conexión e inténtalo de nuevo." accion={{ etiqueta: 'Reintentar', onClick: () => void cargar() }} />
      </Bloque>
    );
  }
  if (lotes === null) {
    return (
      <Bloque {...encabezado}><SkeletonBloque alto="h-56" etiqueta="Cargando precios de los lotes" /></Bloque>
    );
  }
  if (filas.length === 0) {
    return (
      <Bloque {...encabezado}>
        <EstadoVacio mensaje="No hay lotes activos." descripcion="Cuando exista un lote activo podrás cargar aquí el precio al que esperas venderlo." accion={{ etiqueta: 'Ir a lotes', to: '/lotes' }} />
      </Bloque>
    );
  }

  return (
    <Bloque
      {...encabezado}
      acciones={editable && (
        <BotonAccion onClick={() => void guardar()} disabled={guardando || nCambios === 0 || invalidos.length > 0}>
          {guardando ? 'Guardando…' : nCambios > 0 ? `Guardar cambios (${nCambios})` : 'Guardar cambios'}
        </BotonAccion>
      )}
    >
      {editable && (
        <AvisoBorrador formulario="precios de lotes" aviso={borrador.aviso} onDescartar={borrador.descartar} onCerrar={borrador.cerrarAviso} className="mb-3" />
      )}
      {!editable && (
        <p className="mb-3 rounded-lg border border-border bg-surface-alt px-3 py-2 text-xs text-text-secondary">
          Solo lectura. Cambiar un precio estimado lo puede hacer únicamente un superadmin.
        </p>
      )}

      <div className="rounded-xl border border-border bg-surface">
        <div className={`hidden gap-3 border-b border-border px-4 py-2 text-xs font-medium text-text-secondary md:grid ${COLUMNAS}`} role="presentation">
          <span>Lote</span><span>Clase</span>
          <span className="text-right">En stock</span>
          <span className="text-right">Precio por kg (USD)</span>
          <span className="text-right">Valor estimado</span>
          <span>Actualizado</span>
        </div>
        <ul>
          {filas.map(l => <FilaPrecio key={l.id} lote={l} editable={editable} deshabilitado={guardando} edicion={vigentes[l.id]}
            precio={precioEfectivo(l, vigentes)} onCambiar={t => setEdiciones(prev => conEdicion(prev, l, t))} />)}
        </ul>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border bg-surface-alt px-4 py-3 rounded-b-xl">
          <span className="inline-flex items-center gap-1 text-sm font-medium text-text-primary">
            Total estimado
            <InfoTooltip etiqueta="Qué significa: total estimado">Suma de kg en stock × precio estimado por kg de los lotes que tienen precio. Es una proyección de venta, no un costo. Se actualiza mientras escribes.</InfoTooltip>
          </span>
          <span className="text-lg font-semibold tabular-nums text-text-primary" aria-live="polite">{formatearUsd(total)}</span>
          <span className="w-full text-xs text-text-secondary">
            {conPrecio} {conPrecio === 1 ? 'lote con precio' : 'lotes con precio'}
            {sinPrecio > 0 && ` · ${sinPrecio} sin precio (no suman al total)`}
          </span>
        </div>
      </div>
      {invalidos.length > 0 && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700">
          Hay {invalidos.length === 1 ? 'un precio' : `${invalidos.length} precios`} sin sentido. Corrígelos para poder guardar.
        </p>
      )}
    </Bloque>
  );
}

interface FilaProps {
  lote: LotePrecio;
  editable: boolean;
  deshabilitado: boolean;
  edicion: string | undefined;
  precio: number | null;
  onCambiar: (texto: string) => void;
}

function FilaPrecio({ lote, editable, deshabilitado, edicion, precio, onCambiar }: FilaProps) {
  const texto = edicion ?? textoDePrecio(lote.precioEstimadoKg);
  const parseado = parsearPrecio(texto);
  const invalido = !parseado.ok;
  const modificada = edicion !== undefined;
  const valor = valorEstimado(lote.stockKg, precio);
  const clase = CLASE[lote.clase];
  const idCampo = `precio-lote-${lote.id}`;
  const idError = `${idCampo}-error`;
  const etiquetaMovil = 'text-xs text-text-secondary md:hidden';

  return (
    <li className={`grid grid-cols-2 items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-3 last:border-b-0 md:gap-y-0 ${COLUMNAS} ${modificada ? 'bg-brand-50/50' : ''}`}>
      <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 md:col-span-1">
        <label htmlFor={idCampo} className="min-w-0 break-words text-sm font-medium text-text-primary">{lote.nombre}</label>
        {modificada && <Insignia tono="aviso" forma="cuadrada">Sin guardar</Insignia>}
      </div>
      <div className="col-span-2 md:col-span-1"><Insignia tono={clase.tono}>{clase.etiqueta}</Insignia></div>

      <span className={etiquetaMovil}>En stock</span>
      <span className={`text-right text-sm tabular-nums md:col-auto ${lote.stockKg < 0 ? 'font-semibold text-red-700' : 'text-text-primary'}`}>
        {formatearNumero(lote.stockKg, 2)} kg{lote.stockKg < 0 ? ' (negativo)' : ''}
      </span>

      <label htmlFor={idCampo} className={etiquetaMovil}>Precio por kg (USD)</label>
      <div className="text-right">
        {editable ? (
          <>
            <input
              id={idCampo}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={texto}
              disabled={deshabilitado}
              placeholder="Sin precio"
              aria-invalid={invalido}
              aria-describedby={invalido ? idError : undefined}
              onChange={e => onCambiar(e.target.value)}
              className={`w-full min-w-0 rounded-lg border bg-surface px-2.5 py-1.5 text-right text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60 ${invalido ? 'border-red-500' : 'border-border'}`}
            />
            {!parseado.ok && <p id={idError} className="mt-1 text-left text-xs text-red-700">{parseado.motivo}</p>}
          </>
        ) : (
          <span className="text-sm tabular-nums text-text-primary">
            {lote.precioEstimadoKg != null ? `USD ${formatearNumero(lote.precioEstimadoKg, 2)}` : <span className="text-text-muted">Sin precio</span>}
          </span>
        )}
      </div>

      <span className={etiquetaMovil}>Valor estimado</span>
      <span className="text-right text-sm font-medium tabular-nums text-text-primary">
        {valor != null ? formatearUsd(valor) : <span className="font-normal text-text-muted">—</span>}
      </span>

      <span className={etiquetaMovil}>Actualizado</span>
      <span className="text-right text-xs text-text-secondary md:text-left">{lote.actualizadoEn ? fechaCorta(lote.actualizadoEn) : '—'}</span>
    </li>
  );
}
