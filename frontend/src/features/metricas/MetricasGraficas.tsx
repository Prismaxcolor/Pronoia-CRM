import { useMemo } from 'react';
import { BarrasVerticales, Bloque, Dona, EstadoVacio, formatearFechaCorta, formatearKg } from '../../components/ui';
import { hayDatosParaTendencia } from '../../lib/dashboard-kpis';
import { porMaterialDe, porProveedorDe, tendenciaCompras } from '../../lib/metricas-kpis';
import type { MetricaCompraLinea } from '../../services/metricas-service';

/** Gráficas de Métricas (React.lazy: no importar de forma estática). Solo reciben datos ya cargados. */

export function TendenciaCompras({ lineas, desde, hasta }: { lineas: readonly MetricaCompraLinea[]; desde: string; hasta: string }) {
  const t = useMemo(() => tendenciaCompras(lineas, desde, hasta), [lineas, desde, hasta]);
  return (
    <Bloque
      titulo={`Tendencia de kilos comprados (${t.porSemana ? 'por semana' : 'por día'})`}
      queEstasViendo={`los kilos comprados en cada ${t.porSemana ? 'semana (lunes a domingo)' : 'día'} del periodo. ${t.porSemana ? 'El periodo es largo, por eso se agrupa por semana.' : 'Pasa el cursor o usa las flechas para ver cada barra.'}`}
    >
      {hayDatosParaTendencia(t.puntos)
        ? (
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarrasVerticales
              categorias={t.puntos.map(p => formatearFechaCorta(p.fecha))}
              series={[{ etiqueta: 'Kilos comprados', valores: t.puntos.map(p => p.kg) }]}
              formatoValor={formatearKg}
              etiquetaAria={`Kilos comprados ${t.porSemana ? 'por semana' : 'por día'} en el periodo`}
              alto={220}
            />
          </div>
        )
        : (
          <EstadoVacio
            mensaje="Hay pocos días con compras para dibujar una tendencia"
            descripcion="Se grafica cuando el periodo tiene compras confirmadas en al menos 3 días (o semanas). Amplía el periodo o registra más compras."
            accion={{ etiqueta: 'Registrar un pesaje', to: '/pesaje' }}
          />
        )}
    </Bloque>
  );
}

export function RepartoKg({ lineas, vista }: { lineas: readonly MetricaCompraLinea[]; vista: 'material' | 'proveedor' }) {
  const items = useMemo(
    () => (vista === 'material' ? porMaterialDe(lineas) : porProveedorDe(lineas)).filter(a => a.kg > 0).map(a => ({ etiqueta: a.nombre, valor: a.kg })),
    [lineas, vista],
  );
  const nombre = vista === 'material' ? 'material' : 'proveedor';
  return (
    <Bloque
      titulo={`Reparto de kilos por ${nombre}`}
      queEstasViendo={`qué parte de los kilos del periodo corresponde a cada ${nombre}. Se muestran los 5 mayores y el resto se agrupa en «Otros». Cambia entre material y proveedor en el detalle de abajo.`}
    >
      {items.length >= 2
        ? (
          <div className="rounded-xl border border-border bg-surface p-4">
            <Dona items={items} formatoValor={formatearKg} rotuloTotal="Total" etiquetaAria={`Reparto de kilos comprados por ${nombre}`} />
          </div>
        )
        : <EstadoVacio mensaje={`Hace falta más de un ${nombre} para repartir los kilos`} descripcion="Con un solo elemento el reparto sería el 100 % y no aporta información." />}
    </Bloque>
  );
}
