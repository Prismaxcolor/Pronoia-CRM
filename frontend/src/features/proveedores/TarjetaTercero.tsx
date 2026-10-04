import { Link } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, FileText, Mail, MapPin, Pencil, Phone, Send, Trash2 } from 'lucide-react';
import { Insignia, formatearFecha, formatearNumero } from '../../components/ui';
import { TEXTO_TERCERO, type FilaTercero, type TipoTercero } from '../../lib/terceros-kpis';

/** Acciones por fila (las mismas que tenía la tarjeta). Una acción ausente no se muestra: el padre decide por permiso. */
export interface AccionesTercero {
  onEditar?: (t: FilaTerceroConExtra) => void;
  onDesactivar?: (t: FilaTerceroConExtra) => void;
  onReactivar?: (t: FilaTerceroConExtra) => void;
  onBorrar?: (t: FilaTerceroConExtra) => void;
  onVincularTelegram?: (t: FilaTerceroConExtra) => void;
}

export type FilaTerceroConExtra = FilaTercero & { direccion?: string | null };

const BOTON_ICONO = 'rounded-md bg-surface-alt p-1.5 text-text-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

/** Saldo de una fila en texto: "Por pagar USD 1.234,56", "A favor USD 20,00" o "Al día". `null` si no hay cifra. */
function textoSaldo(tipo: TipoTercero, saldo: number | undefined): { etiqueta: string; valor: string } | null {
  if (saldo === undefined) return null;
  if (saldo > 0.005) return { etiqueta: TEXTO_TERCERO[tipo].saldo, valor: `USD ${formatearNumero(saldo, 2)}` };
  if (saldo < -0.005) return { etiqueta: TEXTO_TERCERO[tipo].saldoAFavor, valor: `USD ${formatearNumero(-saldo, 2)}` };
  return { etiqueta: 'Saldo', valor: 'Al día' };
}

/** Estado de Telegram como insignia (texto + icono: no depende del color). */
export function InsigniaTelegram({ fila, corto = false }: { fila: Pick<FilaTercero, 'telegramChatId' | 'telegramLinkedAt'>; corto?: boolean }) {
  if (fila.telegramChatId) {
    return (
      <Insignia tono="exito" icono={<CheckCircle2 size={12} />} title={fila.telegramLinkedAt ? `Telegram vinculado el ${formatearFecha(fila.telegramLinkedAt)}. Se le puede enviar su estado de cuenta.` : 'Telegram vinculado. Se le puede enviar su estado de cuenta.'}>
        {corto ? 'Vinculado' : 'Telegram vinculado'}
      </Insignia>
    );
  }
  return <Insignia tono="neutral" title="Todavía no tiene Telegram vinculado, así que no se le puede enviar su estado de cuenta por ahí.">Sin Telegram</Insignia>;
}

/** Botones de edición (lápiz, ojo, papelera) con nombre accesible. Visibles siempre en móvil; en escritorio al pasar o enfocar. */
export function BotonesGestion({ fila, acciones }: { fila: FilaTerceroConExtra; acciones: AccionesTercero }) {
  const { onEditar, onDesactivar, onReactivar, onBorrar } = acciones;
  const puedeDesactivar = fila.activo && onDesactivar;
  const puedeReactivar = !fila.activo && onReactivar;
  if (!onEditar && !puedeDesactivar && !puedeReactivar && !onBorrar) return null;
  return (
    <div className="flex gap-1">
      {onEditar && (
        <button type="button" onClick={() => onEditar(fila)} aria-label={`Editar ${fila.nombre}`} title="Editar" className={`${BOTON_ICONO} hover:bg-brand-50 hover:text-brand-700`}>
          <Pencil size={13} aria-hidden="true" />
        </button>
      )}
      {puedeDesactivar && (
        <button type="button" onClick={() => onDesactivar(fila)} aria-label={`Desactivar ${fila.nombre}`} title="Desactivar" className={`${BOTON_ICONO} hover:bg-amber-50 hover:text-amber-700`}>
          <EyeOff size={13} aria-hidden="true" />
        </button>
      )}
      {puedeReactivar && (
        <button type="button" onClick={() => onReactivar(fila)} aria-label={`Reactivar ${fila.nombre}`} title="Reactivar" className={`${BOTON_ICONO} hover:bg-brand-50 hover:text-brand-700`}>
          <Eye size={13} aria-hidden="true" />
        </button>
      )}
      {onBorrar && (
        <button type="button" onClick={() => onBorrar(fila)} aria-label={`Borrar definitivamente a ${fila.nombre}`} title="Borrar definitivamente" className={`${BOTON_ICONO} hover:bg-red-50 hover:text-red-700`}>
          <Trash2 size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface TarjetaProps {
  tipo: TipoTercero;
  fila: FilaTerceroConExtra;
  acciones: AccionesTercero;
  /** Con false no se muestran importes ni facturas pendientes (saldos no disponibles). */
  hayCifras: boolean;
  /** Dentro de otra tarjeta (vista móvil de la tabla): sin borde ni relleno propios. */
  incrustada?: boolean;
}

/** Tarjeta de un proveedor o cliente: datos de contacto, saldo, acceso al estado de cuenta y Telegram. */
function TarjetaTercero({ tipo, fila, acciones, hayCifras, incrustada = false }: TarjetaProps) {
  const s = fila.saldo;
  const saldo = hayCifras ? textoSaldo(tipo, s?.saldo ?? 0) : null;
  const gestion = <BotonesGestion fila={fila} acciones={acciones} />;
  return (
    <article className={`group relative flex flex-col ${incrustada ? '' : 'rounded-xl border border-border bg-surface p-4 transition-shadow hover:shadow-md'} ${fila.activo ? '' : 'opacity-75'}`}>
      <div className="absolute right-2 top-2 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">{gestion}</div>

      <div className="mb-3 flex items-start gap-3 pr-24">
        <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
          {fila.nombre.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold leading-tight text-text-primary">{fila.nombre}</h3>
          {fila.identificacion && <p className="mt-0.5 text-xs text-text-secondary">{fila.identificacion}</p>}
          {!fila.activo && <span className="mt-1 inline-block"><Insignia tono="neutral" forma="cuadrada">Inactivo</Insignia></span>}
        </div>
      </div>

      <div className="space-y-1.5 text-xs text-text-secondary">
        {fila.email && <div className="flex items-center gap-1.5 truncate"><Mail size={12} className="shrink-0 text-text-muted" aria-hidden="true" /><span className="truncate">{fila.email}</span></div>}
        {fila.telefono && <div className="flex items-center gap-1.5"><Phone size={12} className="shrink-0 text-text-muted" aria-hidden="true" /><span>{fila.telefono}</span></div>}
        {fila.direccion && <div className="flex items-start gap-1.5"><MapPin size={12} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" /><span className="line-clamp-2">{fila.direccion}</span></div>}
      </div>

      {hayCifras && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-3 text-xs">
          <div>
            <dt className="text-text-secondary" title="Lo facturado menos lo pagado o cobrado, en USD, de todo el historial. Es la misma cifra de su estado de cuenta.">{saldo?.etiqueta ?? 'Saldo'}</dt>
            <dd className="text-sm font-semibold tabular-nums text-text-primary">{saldo?.valor ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-text-secondary" title="Fecha del último movimiento de su cuenta: factura, pago, adelanto o nota.">Última operación</dt>
            <dd className="font-medium tabular-nums text-text-primary">{formatearFecha(s?.ultimaOperacion)}</dd>
          </div>
          {s && s.cantidadFacturasPendientes > 0 && (
            <div className="col-span-2 text-text-secondary">
              {s.cantidadFacturasPendientes} {s.cantidadFacturasPendientes === 1 ? 'factura pendiente' : 'facturas pendientes'}
              {s.antiguedadMasVieja != null && <> · la más vieja tiene {formatearNumero(s.antiguedadMasVieja, 0)} {s.antiguedadMasVieja === 1 ? 'día' : 'días'} desde su fecha</>}
            </div>
          )}
        </dl>
      )}

      <div className="mt-auto pt-4">
        <Link
          to={`/${TEXTO_TERCERO[tipo].ruta}/${fila.id}/estado-cuenta`}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-alt hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <FileText size={14} aria-hidden="true" /> Estado de cuenta
        </Link>
        <div className="mt-2 flex min-h-[2rem] items-center justify-center">
          {fila.telegramChatId ? (
            <InsigniaTelegram fila={fila} />
          ) : acciones.onVincularTelegram ? (
            <button
              type="button"
              onClick={() => acciones.onVincularTelegram?.(fila)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-alt hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <Send size={14} aria-hidden="true" /> Vincular Telegram
            </button>
          ) : (
            <InsigniaTelegram fila={fila} />
          )}
        </div>
      </div>
    </article>
  );
}

export default TarjetaTercero;
