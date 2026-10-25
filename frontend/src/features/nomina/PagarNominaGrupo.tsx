import { Plus } from 'lucide-react';
import type { Banca } from '../../../../shared/types/banca.js';
import type { EstadoComision } from '../cochinito/comision-formulario';
import PagarNominaCuenta from './PagarNominaCuenta';
import { ETIQUETA_GRUPO, cuentasDeGrupo, formatearMontoPago, type GrupoPago } from './nomina-pago';
import {
  agregarCuenta, asignarResto, cambiarFila, centavosDe, cuentasParaFila, esReparto, filasDe, montoDeFila, puedeDividir, quitarCuenta,
  resumenReparto, textoDiferencia, type EleccionPago,
} from './nomina-reparto';

interface Props {
  grupo: GrupoPago;
  bancas: readonly Banca[];
  /** Cuentas elegidas para esta moneda (una = pago completo; varias = reparto). */
  elecciones: readonly EleccionPago[] | undefined;
  comisionDisponible: boolean;
  estadoComision: EstadoComision;
  onReintentarComision: () => void;
  onCambiar: (filas: EleccionPago[]) => void;
}

const botonClass = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors';

/** Estado en vivo del reparto: lo que falta por asignar, lo que excede o que ya cuadra. */
function EstadoReparto({ grupo, filas, total }: { grupo: GrupoPago; filas: readonly EleccionPago[]; total: number }) {
  const resumen = resumenReparto(filas, total);
  const texto = textoDiferencia(grupo.moneda, resumen);
  const tono = resumen.estado === 'completo' ? 'text-green-700' : resumen.estado === 'excede' ? 'text-red-600' : 'text-amber-700';
  return (
    <p role="status" aria-live="polite" className={`text-sm font-semibold tabular-nums ${tono}`}>
      {texto ?? `Reparto completo: ${formatearMontoPago(grupo.moneda, total / 100)}`}
    </p>
  );
}

/**
 * Un grupo de pago (divisas o bolívares): resumen del monto y una o varias cuentas. Con «Dividir en otra cuenta» el pago se reparte
 * entre cuentas de la misma moneda, cada una con su monto (y, en Bs, su propia comisión). Se ofrecen TODAS las cuentas de la
 * moneda a las que la persona tiene acceso de edición, menos las ya elegidas en otra fila.
 */
function PagarNominaGrupo({ grupo, bancas, elecciones, comisionDisponible, estadoComision, onReintentarComision, onCambiar }: Props) {
  const filas = filasDe(elecciones);
  const cuentas = cuentasDeGrupo(bancas, grupo.moneda);
  const total = centavosDe(grupo.monto);
  const reparto = esReparto(filas);
  const resumen = resumenReparto(filas, total);

  return (
    <section className="space-y-3 rounded-xl border border-border p-3" aria-label={`Pago en ${ETIQUETA_GRUPO[grupo.moneda]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">{ETIQUETA_GRUPO[grupo.moneda]} · {grupo.cantidad} trabajador{grupo.cantidad === 1 ? '' : 'es'}</h3>
        <p className="text-sm font-semibold tabular-nums text-text-primary">
          {formatearMontoPago(grupo.moneda, grupo.monto)}
          {grupo.moneda === 'BS' && <span className="ml-2 text-xs font-normal text-text-secondary">equivale a {formatearMontoPago('USD', grupo.montoUsd)}</span>}
        </p>
      </div>
      {filas.map((fila, i) => (
        <PagarNominaCuenta
          key={i} grupo={grupo} indice={i} fila={fila} cuentas={cuentasParaFila(cuentas, filas, i)} reparto={reparto}
          centavos={montoDeFila(filas, i, total) ?? 0} comisionDisponible={comisionDisponible} estadoComision={estadoComision}
          onReintentarComision={onReintentarComision} onCambiar={nueva => onCambiar(cambiarFila(filas, i, nueva))}
          onQuitar={() => onCambiar(quitarCuenta(filas, i))}
        />
      ))}
      {cuentas.length === 0 && (
        <p role="alert" className="text-xs text-red-600">No tienes cuentas {grupo.moneda === 'USD' ? 'en USD' : 'en bolívares'} con acceso de edición.</p>
      )}
      {reparto && <EstadoReparto grupo={grupo} filas={filas} total={total} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        {puedeDividir(cuentas, filas) && (
          <button type="button" onClick={() => onCambiar(agregarCuenta(filas, total))} className={botonClass}>
            <Plus size={16} aria-hidden="true" />Dividir en otra cuenta
          </button>
        )}
        {reparto && resumen.estado !== 'completo' && (
          <button type="button" onClick={() => onCambiar(asignarResto(filas, total))} className={botonClass}>Asignar el resto</button>
        )}
      </div>
    </section>
  );
}

export default PagarNominaGrupo;
