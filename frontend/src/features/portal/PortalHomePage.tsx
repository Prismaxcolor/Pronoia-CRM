import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Wallet, Tag, CalendarClock, FileCheck2, ChevronRight, History } from 'lucide-react';
import { usePortalAuth } from '../../hooks/use-portal-auth-context';
import { obtenerEstadoCuentaPortal, type EstadoCuentaPortal } from '../../services/portal-estado-cuenta-service';
import { obtenerDocumentosPortal, type PortalDocumentos } from '../../services/portal-documentos-service';
import { Bloque, GrillaKpis, TarjetaKpi } from '../../components/ui';
import { formatearNumero, formatearUsdDecimales } from '../../lib/formato';
import { ayudaSaldoPortal, fechaCorta, importeMovimiento, mensajeSaldo, resumenDocumentos, ultimoMovimiento } from '../../lib/portal-kpis';
import PortalLayout from './PortalLayout';

interface Opcion {
  to: string;
  label: string;
  descripcion: string;
  icon: typeof FileText;
}

const OPCIONES: Opcion[] = [
  { to: '/portal/documentos', label: 'Mis documentos', descripcion: 'Facturas, tickets de pesaje y comprobantes', icon: FileText },
  { to: '/portal/estado-cuenta', label: 'Estado de cuenta', descripcion: 'Tu saldo y el historial de movimientos', icon: Wallet },
  { to: '/portal/precios', label: 'Lista de precios', descripcion: 'Precios vigentes por material', icon: Tag },
  { to: '/portal/agendar', label: 'Agendar despacho', descripcion: 'Elige el día y la hora de tu próxima entrega', icon: CalendarClock },
  { to: '/portal/guias', label: 'Guías', descripcion: 'Permisos de traslado y su estado', icon: FileCheck2 },
];

const ETIQUETA_TIPO: Record<string, string> = {
  factura: 'Factura', pago: 'Pago', adelanto: 'Adelanto', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito', cruce: 'Cruce',
};

type Carga<T> = { estado: 'cargando' } | { estado: 'error' } | { estado: 'listo'; datos: T };

function aCarga<T>(datos: T | null): Carga<T> {
  return datos ? { estado: 'listo', datos } : { estado: 'error' };
}

function PortalHomePage() {
  const { entidad } = usePortalAuth();
  const [cuenta, setCuenta] = useState<Carga<EstadoCuentaPortal>>({ estado: 'cargando' });
  const [docs, setDocs] = useState<Carga<PortalDocumentos>>({ estado: 'cargando' });

  useEffect(() => {
    // Dos consultas independientes: si una falla, la otra tarjeta sigue mostrándose.
    obtenerEstadoCuentaPortal().then(d => setCuenta(aCarga(d)));
    obtenerDocumentosPortal().then(d => setDocs(aCarga(d)));
  }, []);

  const saldo = useMemo(() => {
    if (cuenta.estado !== 'listo') return null;
    return { valor: cuenta.datos.totales.saldo, mensaje: mensajeSaldo(cuenta.datos.entidad.tipo, cuenta.datos.totales.saldo) };
  }, [cuenta]);
  const ultimo = useMemo(() => (cuenta.estado === 'listo' ? ultimoMovimiento(cuenta.datos.entradas) : null), [cuenta]);
  const resumen = useMemo(() => (docs.estado === 'listo' ? resumenDocumentos(docs.datos) : null), [docs]);

  const errorCuenta = cuenta.estado === 'error';

  return (
    <PortalLayout
      esInicio
      titulo={`Hola, ${entidad?.nombre ?? ''}`.trim()}
      subtitulo="Aquí ves cómo está tu cuenta con Pronoia y puedes entrar a tus documentos, precios y entregas."
    >
      <GrillaKpis>
        <TarjetaKpi
          titulo="Saldo actual" icono={<Wallet size={16} />}
          ayuda={ayudaSaldoPortal(cuenta.estado === 'listo' ? cuenta.datos.entidad.tipo : undefined)}
          estado={cuenta.estado === 'cargando' ? 'cargando' : errorCuenta ? 'vacio' : 'listo'}
          mensajeVacio="No pudimos cargar tu saldo"
          valor={saldo ? formatearUsdDecimales(Math.abs(saldo.valor)) : undefined}
          subtitulo={saldo?.mensaje.texto}
        />
        <TarjetaKpi
          titulo="Último movimiento" icono={<History size={16} />}
          ayuda="La fecha del movimiento más reciente de tu cuenta (factura, pago, adelanto o nota) y su importe en USD."
          estado={cuenta.estado === 'cargando' ? 'cargando' : errorCuenta ? 'vacio' : ultimo ? 'listo' : 'vacio'}
          mensajeVacio={errorCuenta ? 'No pudimos cargar tus movimientos' : 'Aún no hay movimientos'}
          valor={ultimo ? fechaCorta(ultimo.fecha) : undefined}
          subtitulo={ultimo ? `${ETIQUETA_TIPO[ultimo.tipo] ?? ultimo.tipo} · ${formatearUsdDecimales(importeMovimiento(ultimo))}` : undefined}
        />
        <TarjetaKpi
          titulo="Documentos" icono={<FileText size={16} />}
          ayuda="Cuántos documentos puedes abrir en total: tus facturas (sin las anuladas), tus tickets de pesaje y tus comprobantes de pago. Debajo está el detalle de cada tipo."
          estado={docs.estado === 'cargando' ? 'cargando' : resumen ? 'listo' : 'vacio'}
          mensajeVacio={docs.estado === 'error' ? 'No pudimos cargar tus documentos' : 'Aún no hay documentos'}
          valor={resumen ? formatearNumero(resumen.total) : undefined}
          subtitulo={resumen ? `${resumen.facturas} facturas · ${resumen.tickets} tickets · ${resumen.comprobantes} comprobantes` : undefined}
        />
      </GrillaKpis>

      <Bloque titulo="¿Qué necesitas hoy?" queEstasViendo="Los accesos a todo lo que puedes consultar o pedir desde el portal: tus documentos, tu saldo, los precios, tus entregas y tus guías.">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {OPCIONES.map(({ to, label, descripcion, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className="flex min-h-[64px] items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text-primary">{label}</span>
                  <span className="mt-0.5 block text-xs text-text-secondary">{descripcion}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-text-muted" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Bloque>
    </PortalLayout>
  );
}

export default PortalHomePage;
