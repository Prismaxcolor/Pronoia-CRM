import type { CategoriaWallet, Movimiento } from '@shared/types/index.js';
import FilaRegistro, { type EstadoNavegacionRegistros } from './FilaRegistro';
import { TotalUsd } from './FranjaPeriodo';
import type { ClaveAccion, ContextoAcciones } from './registros-acciones';
import { etiquetaRangoSemana, type SemanaIso } from './registros-logica';
import type { FilaVirtual, FlujoUsd } from './registros-patas';
import { filaConCuentaOculta } from './registros-privacidad';

export interface SemanaConFilas {
  clave: string;
  semana: SemanaIso;
  filas: FilaVirtual[];
  flujo: FlujoUsd;
}

/** Datos y acciones que comparten todas las filas de la lista. */
export interface ComunFilas {
  indiceCategorias: ReadonlyMap<string, CategoriaWallet>;
  nombreContraparte: (m: Movimiento) => string | null;
  nombresCuentas: ReadonlyMap<string, string>;
  cuentasOcultas: ReadonlySet<string>;
  hoy: string;
  ocultarCantidades: boolean;
  /** Enmascara los ∑ (ocultar cantidades, o filtro de cuentas con todas las elegidas ocultas). */
  ocultarSuma: boolean;
  estadoNavegacion: EstadoNavegacionRegistros;
  contextoAcciones: ContextoAcciones;
  onAccion: (clave: ClaveAccion, movimiento: Movimiento) => void;
  onDenegada: (motivo: string) => void;
}

/** Una semana ISO: encabezado con su ∑ y sus filas. No se muestra "Saldo al corte": reconstruirlo exige los efectos históricos
 *  exactos de cada movimiento (mesa de cambio, comisiones) y un saldo que pueda estar mal no se muestra. */
function SemanaRegistros({ grupo, comun }: { grupo: SemanaConFilas; comun: ComunFilas }) {
  const id = `semana-${grupo.clave}`;
  return (
    <section aria-labelledby={id} className="mb-5 rounded-2xl border border-w-borde bg-w-tarjeta">
      <header className="flex items-baseline justify-between gap-3 rounded-t-2xl bg-w-grupo px-4 py-2 text-sm text-w-texto2">
        <h3 id={id} className="font-semibold">
          SEMANA {grupo.semana.semana} <span className="font-normal">· {etiquetaRangoSemana(grupo.semana.lunes, grupo.semana.domingo)}</span>
        </h3>
        <span className="text-right">
          <TotalUsd flujo={grupo.flujo} oculto={comun.ocultarSuma} />
          {grupo.flujo.sinEquivalente > 0 && <span className="block text-xs">{grupo.flujo.sinEquivalente} sin equivalente USD</span>}
        </span>
      </header>
      <ul className="divide-y divide-w-borde">
        {grupo.filas.map(f => (
          <FilaRegistro
            key={f.clave}
            fila={f}
            categoria={f.movimiento.categoriaId ? comun.indiceCategorias.get(f.movimiento.categoriaId) : undefined}
            contraparte={comun.nombreContraparte(f.movimiento)}
            nombresCuentas={comun.nombresCuentas}
            hoy={comun.hoy}
            ocultarCantidades={comun.ocultarCantidades}
            cuentaOculta={filaConCuentaOculta(f, comun.cuentasOcultas)}
            estadoNavegacion={comun.estadoNavegacion}
            contextoAcciones={comun.contextoAcciones}
            onAccion={comun.onAccion}
            onDenegada={comun.onDenegada}
          />
        ))}
      </ul>
    </section>
  );
}

export default SemanaRegistros;
