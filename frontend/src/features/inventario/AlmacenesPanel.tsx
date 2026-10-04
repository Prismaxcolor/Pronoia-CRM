import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Coins, Plus, Star, Warehouse } from 'lucide-react';
import {
  obtenerAlmacenes,
  desactivarAlmacen,
  reactivarAlmacen,
  marcarPredeterminado,
} from '../../services/almacen-service';
import { obtenerResumenInventario, type ResumenInventario } from '../../services/inventario-resumen-service';
import { obtenerDetallePantalla } from '../../services/inventario-pantalla-service';
import { useAuth } from '../../hooks/use-auth-context';
import { useToast } from '../../hooks/use-toast-context';
import {
  AlertaItem, Bloque, BotonAccion, EstadoVacio, GrillaKpis, SkeletonBloque, SkeletonKpis, TarjetaKpi,
  formatearFecha, formatearKg, formatearNumero, formatearUsd,
} from '../../components/ui';
import VisorFotos from '../../components/VisorFotos';
import {
  armarTarjetasAlmacen, kpisAlmacenes, valorPorAlmacen, type ValorAlmacen,
} from '../../lib/almacenes-kpis';
import AlmacenFormModal from './AlmacenFormModal';
import AlmacenTarjeta from './AlmacenTarjeta';
import type { Almacen } from '@shared/types/index.js';

/** Filas máximas que acepta el detalle del inventario (para sumar el valor por almacén). */
const FILAS_DETALLE = '2000';

type Lectura<T> = { estado: 'cargando' } | { estado: 'ok'; dato: T } | { estado: 'error'; mensaje: string };

function AlmacenesPanel() {
  const { tienePermiso } = useAuth();
  const toast = useToast();
  const puedeCrear = tienePermiso('almacenes', 'crear');
  const puedeEditar = tienePermiso('almacenes', 'editar');
  const puedeVerKg = tienePermiso('productos', 'ver');
  const puedeVerValor = tienePermiso('facturacion', 'ver');

  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [resumen, setResumen] = useState<Lectura<ResumenInventario>>({ estado: 'cargando' });
  const [valores, setValores] = useState<Lectura<{ mapa: Map<string, ValorAlmacen>; truncado: boolean }>>({ estado: 'cargando' });
  const [formAbierto, setFormAbierto] = useState<{ abierto: true; almacen: Almacen | null } | { abierto: false }>({ abierto: false });
  const [visor, setVisor] = useState<{ almacen: Almacen; indice: number } | null>(null);

  const recargar = () => obtenerAlmacenes().then(setAlmacenes).finally(() => setCargando(false));
  const cargar = () => { setCargando(true); recargar(); };

  useEffect(() => {
    recargar();
  }, []);

  // Kg por almacén (resumen) y valor por almacén (detalle): bloques aparte, cada uno con su propio fallo.
  const [versionLectura, setVersionLectura] = useState(0);
  useEffect(() => {
    let cancelado = false;
    if (!puedeVerKg) return;
    obtenerResumenInventario().then(r => {
      if (cancelado) return;
      setResumen('error' in r ? { estado: 'error', mensaje: r.error } : { estado: 'ok', dato: r.resumen });
    });
    if (puedeVerValor) {
      obtenerDetallePantalla(new URLSearchParams({ limite: FILAS_DETALLE })).then(r => {
        if (cancelado) return;
        setValores('error' in r
          ? { estado: 'error', mensaje: r.error }
          : { estado: 'ok', dato: { mapa: valorPorAlmacen(r.dato.filas), truncado: r.dato.limite.truncado } });
      });
    }
    return () => { cancelado = true; };
  }, [puedeVerKg, puedeVerValor, versionLectura]);

  const handleDesactivar = async (a: Almacen) => {
    const result = await desactivarAlmacen(a.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${a.nombre}" desactivado.`);
    cargar();
  };

  const handleReactivar = async (a: Almacen) => {
    const result = await reactivarAlmacen(a.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`"${a.nombre}" reactivado.`);
    cargar();
  };

  const handlePredeterminado = async (a: Almacen) => {
    if (a.esPredeterminado) return;
    const result = await marcarPredeterminado(a.id);
    if ('error' in result) { toast.errorMsg(result.error); return; }
    toast.exito(`Ahora las compras y ventas afectan a "${a.nombre}".`);
    cargar();
  };

  const hayPredeterminado = almacenes.some(a => a.esPredeterminado && a.activo);
  const kgResumen = resumen.estado === 'ok' ? resumen.dato.almacenes : null;
  const mapaValores = valores.estado === 'ok' && puedeVerValor ? valores.dato.mapa : null;
  const tarjetas = useMemo(() => armarTarjetasAlmacen(almacenes, kgResumen, mapaValores), [almacenes, kgResumen, mapaValores]);
  const kpis = useMemo(() => kpisAlmacenes(almacenes, kgResumen, new Date()), [almacenes, kgResumen]);
  const r = resumen.estado === 'ok' ? resumen.dato : null;

  if (cargando && almacenes.length === 0) {
    return (
      <div aria-busy="true">
        <SkeletonKpis />
        <SkeletonBloque alto="h-64" conMargen etiqueta="Cargando almacenes" />
      </div>
    );
  }

  const accionNuevo = puedeCrear ? (
    <BotonAccion icono={<Plus size={16} />} onClick={() => setFormAbierto({ abierto: true, almacen: null })}>Nuevo almacén</BotonAccion>
  ) : undefined;

  return (
    <div>
      <section aria-label="Indicadores de almacenes" className="mb-8">
        <GrillaKpis>
          <TarjetaKpi
            titulo="Kg en galpón"
            icono={<Warehouse size={16} />}
            ayuda="Suma de los kg que hay hoy en todos los almacenes, contando materiales y lotes. Es la misma cifra de la pantalla de Inventario."
            estado={!puedeVerKg ? 'sinPermiso' : resumen.estado === 'cargando' ? 'cargando' : kpis.totalKg == null ? 'vacio' : 'listo'}
            mensajeVacio="No se pudo leer el inventario"
            valor={kpis.totalKg != null ? formatearKg(kpis.totalKg) : undefined}
            subtitulo="en todos los almacenes, hoy"
            comparacion={null}
          />
          <TarjetaKpi
            titulo="Valor del inventario (a costo)"
            icono={<Coins size={16} />}
            ayuda="Cuánto costó comprar los materiales que hay hoy en los almacenes, en USD. Se multiplican los kg de cada material por su precio promedio de compra por kg (según las facturas de compra). Los kg sin precio de compra no se cuentan, y los lotes van aparte con su precio de venta estimado, que no se suma."
            estado={!puedeVerValor ? 'sinPermiso' : !puedeVerKg ? 'vacio' : resumen.estado === 'cargando' ? 'cargando' : !r?.valor ? 'vacio' : 'listo'}
            mensajeVacio="No se pudo leer el valor"
            valor={r?.valor ? formatearUsd(r.valor.costoMateriales.valorUsd) : undefined}
            subtitulo="lo que costó comprar los materiales"
            comparacion={null}
          >
            {r?.valor && (
              <p className="mt-1 text-xs text-text-muted">
                {r.valor.costoMateriales.kgSinCosto > 0
                  ? `${formatearKg(r.valor.costoMateriales.kgSinCosto)} sin precio de compra (no entran en el costo) · `
                  : ''}
                {r.valor.ventaEstimadaLotes.kgConPrecio > 0
                  ? `Lotes: ${formatearUsd(r.valor.ventaEstimadaLotes.valorUsd)} si se vendieran al precio estimado (aparte, no se suma al costo)`
                  : 'Lotes: sin precio estimado cargado'}
              </p>
            )}
          </TarjetaKpi>
          <TarjetaKpi
            titulo="Almacenes activos"
            icono={<Star size={16} />}
            ayuda="Cantidad de almacenes en uso (los desactivados no se cuentan). El predeterminado es el almacén que suma o resta kg automáticamente con cada compra y venta."
            valor={formatearNumero(kpis.activos, 0)}
            subtitulo={kpis.predeterminado ? `predeterminado: ${kpis.predeterminado}` : 'ninguno es el predeterminado'}
            comparacion={null}
          >
            {kpis.inactivos > 0 && <p className="mt-1 text-xs text-text-muted">{formatearNumero(kpis.inactivos, 0)} inactivo{kpis.inactivos === 1 ? '' : 's'}</p>}
          </TarjetaKpi>
          <TarjetaKpi
            titulo="Toma física más antigua"
            icono={<CalendarCheck size={16} />}
            ayuda="Entre los almacenes activos, el que hace más tiempo que no cierra una toma física (contar el material a mano y corregir el sistema con lo contado). Muestra la fecha de esa última toma y los días transcurridos. «Nunca» quiere decir que ese almacén no ha cerrado ninguna."
            estado={kpis.tomaMasAntigua ? 'listo' : 'vacio'}
            mensajeVacio="Aún no hay almacenes activos"
            valor={kpis.tomaMasAntigua ? (kpis.tomaMasAntigua.fecha ? formatearFecha(kpis.tomaMasAntigua.fecha) : 'Nunca') : undefined}
            subtitulo={kpis.tomaMasAntigua ? `${kpis.tomaMasAntigua.almacen}${kpis.tomaMasAntigua.dias != null ? ` · hace ${formatearNumero(kpis.tomaMasAntigua.dias, 0)} días` : ''}` : undefined}
            comparacion={null}
          />
        </GrillaKpis>
      </section>

      {!hayPredeterminado && almacenes.length > 0 && (
        <ul className="mb-6">
          <AlertaItem
            severidad="amarilla"
            texto="Ningún almacén está marcado como predeterminado: las compras y ventas nuevas no afectarán a ningún almacén."
            detalle={puedeEditar ? 'Marca uno con la estrella de su tarjeta.' : 'Pide a quien administra el sistema que marque uno.'}
          />
        </ul>
      )}

      {puedeVerKg && resumen.estado === 'error' && (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          No se pudieron leer los kilos por almacén ({resumen.mensaje || 'error de lectura'}). Las tarjetas muestran «—» en vez de un 0 engañoso.
        </p>
      )}
      {puedeVerValor && valores.estado === 'ok' && valores.dato.truncado && (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Hay más filas de inventario que las que se pueden sumar de una vez: el valor por almacén puede estar incompleto.
        </p>
      )}
      {puedeVerValor && valores.estado === 'error' && (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          No se pudo calcular el valor por almacén ({valores.mensaje || 'error de lectura'}).
          {' '}
          <button type="button" onClick={() => { setValores({ estado: 'cargando' }); setVersionLectura(v => v + 1); }} className="font-medium underline underline-offset-2">Reintentar</button>
        </p>
      )}

      <Bloque
        titulo="Almacenes"
        queEstasViendo="Cada tarjeta es un almacén (galpón) con su foto, los kg que tiene hoy y, si tienes permiso, cuánto valen. Las compras y ventas suman o restan en el almacén predeterminado; los traslados mueven material de un almacén a otro."
        acciones={accionNuevo}
      >
        {almacenes.length === 0 ? (
          <EstadoVacio
            icono={<Warehouse size={26} />}
            mensaje="Todavía no hay almacenes registrados"
            descripcion="Un almacén es un galpón o depósito donde se guarda el material. Sin almacenes, las compras y ventas no pueden descontar ni sumar inventario."
            accion={puedeCrear ? { etiqueta: 'Crear el primer almacén', onClick: () => setFormAbierto({ abierto: true, almacen: null }) } : undefined}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tarjetas.map(t => (
              <li key={t.almacen.id} className="flex flex-col">
                <AlmacenTarjeta
                  tarjeta={t}
                  puedeEditar={puedeEditar}
                  puedeVerValor={puedeVerValor}
                  puedeVerKg={puedeVerKg}
                  onVerFotos={a => setVisor({ almacen: a, indice: 0 })}
                  onEditar={a => setFormAbierto({ abierto: true, almacen: a })}
                  onDesactivar={handleDesactivar}
                  onReactivar={handleReactivar}
                  onPredeterminado={handlePredeterminado}
                />
              </li>
            ))}
          </ul>
        )}
        {puedeVerKg && almacenes.length > 0 && (
          <p className="mt-3 text-xs text-text-muted">
            Para ver qué material hay en cada almacén, usa «Ver su inventario» en la tarjeta o el filtro de almacén de la pantalla de Inventario.
          </p>
        )}
      </Bloque>

      {formAbierto.abierto && (
        <AlmacenFormModal
          almacen={formAbierto.almacen}
          onClose={() => setFormAbierto({ abierto: false })}
          onGuardado={() => { setFormAbierto({ abierto: false }); cargar(); }}
        />
      )}

      {visor && (
        <VisorFotos
          fotos={visor.almacen.fotos}
          indice={visor.indice}
          onCambiar={indice => setVisor(v => (v ? { ...v, indice } : v))}
          onCerrar={() => setVisor(null)}
          alt={`Foto de ${visor.almacen.nombre}`}
        />
      )}
    </div>
  );
}

export default AlmacenesPanel;
