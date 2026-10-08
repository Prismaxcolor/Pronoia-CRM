import { useMemo } from 'react';
import { BarrasHorizontales, BarrasVerticales, Bloque, Dona, EstadoVacio, formatearFechaCorta, formatearNumero, formatearUsd, infoEstado } from '../../components/ui';
import {
  MIN_ENTIDADES_RANKING, MIN_ESTADOS_DONA, haySuficientesSemanas, partesPorEstado, topEntidades, totalesPorSemana,
} from '../../lib/facturas-kpis';
import type { FacturaCV, TipoFactura } from '../../services/factura-cv-service';

/** Gráficas del historial de facturas (se cargan con React.lazy después de los indicadores).
 *  Reciben las facturas del periodo (sin el filtro de estado ni de código). Cada una solo se dibuja si hay datos suficientes;
 *  si no, explica por qué y qué hacer. */
interface Props {
  facturas: readonly FacturaCV[];
  tipo: TipoFactura;
  /** Ruta para crear una factura (solo si el usuario puede crear). */
  rutaNueva?: string;
}

const cantidadFacturas = (n: number) => `${formatearNumero(n, 0)} ${n === 1 ? 'factura' : 'facturas'}`;

function FacturaGraficas({ facturas, tipo, rutaNueva }: Props) {
  const esCompra = tipo === 'compra';
  const plural = esCompra ? 'proveedores' : 'clientes';
  const semanas = useMemo(() => totalesPorSemana(facturas), [facturas]);
  const partes = useMemo(() => partesPorEstado(facturas), [facturas]);
  const ranking = useMemo(() => topEntidades(facturas), [facturas]);

  const semanasConDatos = semanas.filter(s => s.cantidad > 0).length;
  const accionVacia = rutaNueva ? { etiqueta: 'Crear una factura', to: rutaNueva } : undefined;

  return (
    <div className="relative grid gap-x-8 overflow-x-clip lg:grid-cols-2">
      <Bloque titulo="Facturación por semana" queEstasViendo="cuántos USD se facturaron cada semana (de lunes a domingo), según la fecha de emisión. Suma las facturas emitidas y pagadas; no cuenta las anuladas ni los borradores.">
        {haySuficientesSemanas(semanas) ? (
          <BarrasVerticales
            categorias={semanas.map(s => formatearFechaCorta(s.inicio))}
            series={[{ etiqueta: 'Total facturado', valores: semanas.map(s => s.total) }]}
            formatoValor={formatearUsd}
            etiquetaAria={`Total facturado por semana en facturas de ${esCompra ? 'compra' : 'venta'}; cada barra es una semana que empieza en la fecha indicada`}
          />
        ) : (
          <EstadoVacio
            mensaje="Aún no hay semanas suficientes para comparar"
            descripcion={`Las facturas de este periodo caen en ${semanasConDatos === 0 ? 'ninguna semana' : 'una sola semana'}. La gráfica aparece cuando hay facturas en al menos 2 semanas distintas.`}
            accion={accionVacia}
          />
        )}
      </Bloque>

      <Bloque titulo="Facturas por estado" queEstasViendo="cuántas facturas del periodo hay en cada estado: emitida (sin ningún pago), pendiente (con pagos y saldo por pagar), pagada (sin saldo), borrador (aún no emitida) o anulada (cancelada). Aquí sí se cuentan todas.">
        {partes.length >= MIN_ESTADOS_DONA ? (
          <Dona
            items={partes.map(p => ({ etiqueta: infoEstado(p.estado).etiqueta, valor: p.cantidad }))}
            formatoValor={cantidadFacturas}
            rotuloTotal="Facturas"
            etiquetaAria="Reparto de facturas por estado"
          />
        ) : (
          <EstadoVacio
            mensaje={partes.length === 1 ? `Todas las facturas del periodo están en estado ${infoEstado(partes[0].estado).etiqueta.toLowerCase()}` : 'No hay facturas en este periodo'}
            descripcion="La dona se muestra cuando hay facturas en al menos 2 estados distintos."
          />
        )}
      </Bloque>

      <div className="lg:col-span-2">
        <Bloque
          titulo={`Principales ${plural}`}
          queEstasViendo={`a quién se le ${esCompra ? 'compró' : 'vendió'} más en el periodo. Cada barra suma, en USD, las facturas emitidas y pagadas de ese ${esCompra ? 'proveedor' : 'cliente'}; no cuenta anuladas ni borradores.`}
        >
          {ranking.length >= MIN_ENTIDADES_RANKING ? (
            <BarrasHorizontales
              datos={ranking.map(e => ({ etiqueta: e.nombre, valor: e.total, detalle: cantidadFacturas(e.cantidad) }))}
              formatoValor={formatearUsd}
              maxFilas={8}
              etiquetaAria={`Monto facturado por ${esCompra ? 'proveedor' : 'cliente'}`}
            />
          ) : ranking.length === 0 ? (
            <EstadoVacio mensaje={`No hay ${plural} con facturas en este periodo`} accion={accionVacia} />
          ) : (
            <div className="rounded-xl border border-border bg-surface p-4">
              <ul className="space-y-1 text-sm">
                {ranking.map(e => (
                  <li key={e.clave} className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="text-text-primary">{e.nombre}</span>
                    <span className="tabular-nums text-text-secondary">{formatearUsd(e.total)} · {cantidadFacturas(e.cantidad)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-text-secondary">El ranking en barras aparece cuando hay al menos {MIN_ENTIDADES_RANKING} {plural} con facturas.</p>
            </div>
          )}
        </Bloque>
      </div>
    </div>
  );
}

export default FacturaGraficas;
