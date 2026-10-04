import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Scale, Truck, Clock } from 'lucide-react';
import { obtenerTraslados } from '../../services/traslado-service';
import { useAuth } from '../../hooks/use-auth-context';
import CompletarTrasladoModal from './CompletarTrasladoModal';
import EditarTrasladoModal from './EditarTrasladoModal';
import TrasladoDetalleModal from './TrasladoDetalleModal';
import TrasladosTabla, { BotonesTraslado, type AccionesTraslado } from './TrasladosTabla';
import { obtenerConfigLlaves } from '../../services/llave-service';
import { useToast } from '../../hooks/use-toast-context';
import {
  Bloque, EstadoVacio, FiltrosBarra, GrillaKpis, Insignia, ListaAlertas, SkeletonBloque, SkeletonKpis, TarjetaKpi, useFiltrosUrl,
  formatearFecha, formatearKg, formatearKgDecimales, formatearNumero,
} from '../../components/ui';
import { hoyLocal, rangoDeAtajo } from '../../lib/rango-fechas';
import type { EsquemaFiltros } from '../../lib/filtros-url';
import {
  DIAS_PENDIENTE_ATENCION, alertasTraslados, almacenesDeTraslados, diasDesde, filtrarTraslados, kpisTraslados, resumenMaterialesTraslado,
  type EstadoTrasladoFiltro,
} from '../../lib/almacenes-kpis';
import type { Traslado } from '@shared/types/index.js';

/** Filtros en la URL. Nombres propios del panel (no chocan con `pestana` ni con los de Lotes). */
const ESQUEMA: EsquemaFiltros = {
  campos: {
    desde: { tipo: 'fecha' },
    hasta: { tipo: 'fecha' },
    testado: { tipo: 'opcion', opciones: ['pendiente', 'completo'] },
    origen: { tipo: 'texto' },
    destino: { tipo: 'texto' },
    tq: { tipo: 'texto' },
    traslado: { tipo: 'texto' },
  },
  rangos: [['desde', 'hasta']],
};

const OPCIONES_ESTADO = [{ valor: 'pendiente', etiqueta: 'Pendientes de recepción' }, { valor: 'completo', etiqueta: 'Completados' }];

function TrasladosPanel() {
  const { tienePermiso, usuario } = useAuth();
  const toast = useToast();
  const puedeCompletar = tienePermiso('traslados', 'crear');
  const esSuperadmin = usuario?.rol === 'superadmin';
  // El servidor exige llave a no-superadmin (llave activa por defecto): quien no tiene el permiso
  // 'editar' igual puede editar presentando una llave. Valor seguro hasta que responda el servidor.
  const [requiereLlave, setRequiereLlave] = useState(true);
  const puedeEditar = tienePermiso('traslados', 'editar') || (requiereLlave && !esSuperadmin);

  const [traslados, setTraslados] = useState<Traslado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aCompletar, setACompletar] = useState<Traslado | null>(null);
  const [aEditar, setAEditar] = useState<Traslado | null>(null);
  const { filtros, cambiar, limpiar } = useFiltrosUrl(ESQUEMA);

  const recargar = () => obtenerTraslados().then(setTraslados).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => { recargar(); }, []);
  useEffect(() => { obtenerConfigLlaves().then(cfg => setRequiereLlave(cfg.requiereLlave)); }, []);

  const hoy = useMemo(() => new Date(), []);
  const desdeUrl = typeof filtros.desde === 'string' ? filtros.desde : undefined;
  const hastaUrl = typeof filtros.hasta === 'string' ? filtros.hasta : undefined;
  // Sin periodo en la URL equivale a «30 días» (igual que el resto de pantallas).
  const rango = useMemo(() => (desdeUrl && hastaUrl ? { desde: desdeUrl, hasta: hastaUrl } : rangoDeAtajo('30d', hoyLocal(hoy))), [desdeUrl, hastaUrl, hoy]);
  const estado = typeof filtros.testado === 'string' ? (filtros.testado as EstadoTrasladoFiltro) : undefined;
  const origen = typeof filtros.origen === 'string' ? filtros.origen : undefined;
  const destino = typeof filtros.destino === 'string' ? filtros.destino : undefined;
  const q = typeof filtros.tq === 'string' ? filtros.tq : undefined;
  const idDetalle = typeof filtros.traslado === 'string' ? filtros.traslado : undefined;

  const kpis = useMemo(() => kpisTraslados(traslados, rango, hoy), [traslados, rango, hoy]);
  const alertas = useMemo(() => alertasTraslados(traslados, hoy), [traslados, hoy]);
  const pendientes = useMemo(
    () => traslados.filter(t => t.estado === 'pendiente').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [traslados],
  );
  const visibles = useMemo(
    () => filtrarTraslados(traslados, { desde: rango.desde, hasta: rango.hasta, estado, origen, destino, q }),
    [traslados, rango, estado, origen, destino, q],
  );
  const opcionesOrigen = useMemo(() => almacenesDeTraslados(traslados, 'origen'), [traslados]);
  const opcionesDestino = useMemo(() => almacenesDeTraslados(traslados, 'destino'), [traslados]);
  const detalle = idDetalle ? traslados.find(t => t.id === idDetalle) ?? null : null;
  const hayFiltros = Boolean(desdeUrl || estado || origen || destino || q);

  const abrirDetalle = useCallback((t: Traslado) => cambiar({ traslado: t.id }), [cambiar]);
  const cerrarDetalle = useCallback(() => cambiar({ traslado: undefined }), [cambiar]);

  const acciones: AccionesTraslado = {
    puedeCompletar, puedeEditar, onDetalle: abrirDetalle, onEditar: setAEditar, onCompletar: setACompletar,
  };

  if (cargando && traslados.length === 0) {
    return (
      <div aria-busy="true">
        <SkeletonKpis />
        <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando traslados" />
      </div>
    );
  }

  const textoRango = desdeUrl ? `${formatearFecha(rango.desde)} al ${formatearFecha(rango.hasta)}` : 'últimos 30 días';
  const sinTraslados = traslados.length === 0;

  return (
    <div>
      <FiltrosBarra
        rango={{ desde: desdeUrl, hasta: hastaUrl, onCambiar: r => cambiar({ desde: r.desde, hasta: r.hasta }) }}
        selectores={[{ id: 'tras-estado', etiqueta: 'Estado', valor: estado, opciones: OPCIONES_ESTADO, onCambiar: v => cambiar({ testado: v }), textoTodas: 'Todos' }]}
        buscador={{ id: 'tras-buscar', valor: q, onCambiar: v => cambiar({ tq: v }), placeholder: 'Código, vehículo, material…' }}
        avanzados={[
          { id: 'tras-origen', etiqueta: 'Almacén de origen', valor: origen, opciones: opcionesOrigen, onCambiar: v => cambiar({ origen: v }) },
          { id: 'tras-destino', etiqueta: 'Almacén de destino', valor: destino, opciones: opcionesDestino, onCambiar: v => cambiar({ destino: v }) },
        ]}
        onLimpiar={limpiar}
      />

      <section aria-label="Indicadores de traslados" className="mb-8">
        <GrillaKpis>
          <TarjetaKpi
            titulo="Kg trasladados"
            icono={<Truck size={16} />}
            ayuda="Kilos netos que salieron de un almacén hacia otro en el periodo elegido, según el día en que se registró el envío. Cuenta lo enviado, no lo recibido."
            valor={formatearKg(kpis.kgEnviado)}
            subtitulo={`${formatearNumero(kpis.creados, 0)} traslado${kpis.creados === 1 ? '' : 's'} · ${textoRango}`}
            comparacion={kpis.comparacionKg ?? undefined}
            formatoDelta={d => formatearKg(d)}
          >
            {!kpis.comparacionKg && (
              <p className="mt-2 text-xs text-text-muted" title="El dato real del sistema empieza a mediados de septiembre de 2026">vs periodo anterior: sin historial comparable</p>
            )}
          </TarjetaKpi>
          <TarjetaKpi
            titulo="Pendientes de recepción"
            icono={<Clock size={16} />}
            ayuda="Traslados que ya salieron del origen pero el almacén destino todavía no confirmó la llegada. Ese material está en tránsito: no está en ningún almacén hasta que se recepciona. Cuenta todos los pendientes, no solo los del periodo."
            valor={formatearNumero(kpis.pendientes, 0)}
            subtitulo={kpis.pendientes > 0 ? `${formatearKg(kpis.kgEnTransito)} en tránsito` : 'nada en tránsito'}
            comparacion={null}
          >
            {kpis.masViejoPendienteDias != null && (
              <p className="mt-1 text-xs text-text-muted">El más viejo lleva {formatearNumero(kpis.masViejoPendienteDias, 0)} día{kpis.masViejoPendienteDias === 1 ? '' : 's'}</p>
            )}
          </TarjetaKpi>
          <TarjetaKpi
            titulo="Completados"
            icono={<CheckCircle2 size={16} />}
            ayuda="Traslados que el almacén destino ya recepcionó, según la fecha de recepción dentro del periodo. Se muestran los kilos que realmente llegaron."
            estado={kpis.completados === 0 ? 'vacio' : 'listo'}
            mensajeVacio="Ningún traslado recepcionado en este periodo"
            valor={formatearKg(kpis.kgRecibido)}
            subtitulo={`${formatearNumero(kpis.completados, 0)} recepcionado${kpis.completados === 1 ? '' : 's'} · kg recibidos`}
            comparacion={null}
          />
          <TarjetaKpi
            titulo="Diferencia enviado vs recibido"
            icono={<Scale size={16} />}
            ayuda="Kilos recibidos menos kilos enviados en los traslados completados del periodo. Cero es lo ideal; una diferencia pide revisar la báscula o el traslado. No es una pérdida confirmada."
            estado={kpis.completados === 0 ? 'vacio' : 'listo'}
            mensajeVacio="Aparece al recepcionar el primer traslado"
            valor={`${kpis.diferenciaKg > 0 ? '+' : ''}${formatearKgDecimales(kpis.diferenciaKg, 2)}`}
            subtitulo={kpis.conDiferencia > 0 ? `${formatearNumero(kpis.conDiferencia, 0)} traslado${kpis.conDiferencia === 1 ? '' : 's'} con diferencia` : 'todos coinciden'}
            comparacion={null}
          />
        </GrillaKpis>
      </section>

      {alertas.length > 0 && (
        <Bloque titulo="Alertas" queEstasViendo={`Traslados que llevan ${DIAS_PENDIENTE_ATENCION} días o más esperando que el almacén destino confirme la recepción.`}>
          <ListaAlertas alertas={alertas.map(a => ({ id: a.id, severidad: a.severidad, texto: a.texto, detalle: a.detalle }))} />
        </Bloque>
      )}

      <Bloque
        titulo="Pendientes de recepción"
        queEstasViendo="Material que ya salió de un almacén y todavía no llegó al otro. Quien está en el destino lo recepciona con las fotos de evidencia."
      >
        {pendientes.length === 0 ? (
          <EstadoVacio
            icono={<CheckCircle2 size={24} />}
            mensaje="No hay traslados pendientes"
            descripcion="Todo lo que salió de un almacén ya fue recepcionado en el otro. Los nuevos traslados se crean desde Pesaje."
            accion={{ etiqueta: 'Crear un traslado en Pesaje', to: '/pesaje' }}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pendientes.map(t => {
              const dias = diasDesde(t.createdAt, hoy);
              return (
                <li key={t.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary">{t.codigo}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-sm text-text-secondary">
                        {t.nombreAlmacenOrigen ?? '—'} <ArrowRight size={13} aria-label="hacia" /> {t.nombreAlmacenDestino ?? '—'}
                      </p>
                    </div>
                    <Insignia tono={dias >= DIAS_PENDIENTE_ATENCION ? 'aviso' : 'neutral'}>
                      {dias === 0 ? 'Salió hoy' : `Hace ${formatearNumero(dias, 0)} día${dias === 1 ? '' : 's'}`}
                    </Insignia>
                  </div>
                  <p className="mt-2 text-sm text-text-primary">
                    <span className="font-medium tabular-nums">{formatearKgDecimales(t.pesoNetoEnviado, 2)}</span>
                    <span className="text-text-secondary"> · {resumenMaterialesTraslado(t)}</span>
                  </p>
                  <div className="mt-3 flex justify-end border-t border-border pt-2">
                    <BotonesTraslado t={t} a={acciones} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Bloque>

      <Bloque
        titulo="Historial de traslados"
        queEstasViendo={`Todos los traslados enviados en ${desdeUrl ? textoRango : 'los últimos 30 días'}${hayFiltros ? ', con los filtros aplicados' : ''}. Pulsa un encabezado para ordenar o «Detalle» para ver cada pesada y sus fotos.`}
      >
        {sinTraslados ? (
          <EstadoVacio
            icono={<Truck size={24} />}
            mensaje="Todavía no hay traslados"
            descripcion="Los traslados mueven material de un almacén a otro. Se crean desde Pesaje, con el tipo «Traslado», y quedan pendientes hasta que el almacén destino confirma la recepción."
            accion={{ etiqueta: 'Ir a Pesaje', to: '/pesaje' }}
          />
        ) : (
          <TrasladosTabla traslados={visibles} acciones={acciones} hoy={hoy} hayFiltros={hayFiltros} onLimpiar={limpiar} />
        )}
      </Bloque>

      {detalle && <TrasladoDetalleModal traslado={detalle} onClose={cerrarDetalle} />}

      {aEditar && (
        <EditarTrasladoModal
          traslado={aEditar}
          requiereLlave={requiereLlave && !esSuperadmin}
          esSuperadmin={esSuperadmin}
          onClose={() => setAEditar(null)}
          onGuardado={() => {
            setAEditar(null);
            cargar();
            toast.exito('Traslado actualizado.');
          }}
        />
      )}

      {aCompletar && (
        <CompletarTrasladoModal
          traslado={aCompletar}
          onClose={() => setACompletar(null)}
          onCompletado={cargar}
        />
      )}
    </div>
  );
}

export default TrasladosPanel;
