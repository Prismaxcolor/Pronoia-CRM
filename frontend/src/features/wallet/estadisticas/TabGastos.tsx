import { useMemo, useState } from 'react';
import ControlSegmentado from '../../../components/ui/ControlSegmentado';
import type { ContextoEstadisticas } from './contexto';
import { Aviso, Tarjeta, Vacio } from './elementos';
import { AGRUPACIONES, filasDeAgrupacion, type Agrupacion } from './estadisticas-gastos';
import { tituloVacio } from './estadisticas-logica';
import ListaProfunda from './ListaProfunda';
import { DonaGastos, TendenciaGastos, TopGastos } from './TarjetasGastos';
import { useNombresContraparte } from './useNombresContraparte';

// "Naturaleza del gasto" (Debo / Necesito / Quiero) queda fuera: requiere una columna que aún no existe en los movimientos.

const TITULO_PRINCIPALES: Readonly<Record<Agrupacion, string>> = {
  categoria: 'Categorías principales',
  subcategoria: 'Subcategorías principales',
  cuenta: 'Cuentas con más gasto',
  contraparte: 'Proveedores y clientes principales',
};
const AYUDA: Readonly<Record<Agrupacion, string>> = {
  categoria: 'Toca una categoría para ver sus subcategorías; toca una subcategoría para ver sus registros. El gasto "sin subcategoría" no abre registros por sí solo: usa "Ver todos los registros" de la categoría (incluye sus subcategorías).',
  subcategoria: 'Toca una subcategoría para ver sus registros. El gasto "sin subcategoría" de una categoría no abre registros por sí solo.',
  cuenta: 'Toca una cuenta para ver sus registros del período.',
  contraparte: 'Solo lectura: Registros todavía no filtra por proveedor o cliente.',
};

function Principales({ ctx, agrupacion, filas }: { ctx: ContextoEstadisticas; agrupacion: Agrupacion; filas: ReturnType<typeof filasDeAgrupacion> }) {
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const alternar = (clave: string): void => setAbiertas(prev => (prev.has(clave) ? new Set([...prev].filter(c => c !== clave)) : new Set([...prev, clave])));
  // Las categorías abiertas cambian lo que muestra la tarjeta: entran en la clave para que la imagen compartida nunca sea una versión vieja.
  const claveImagen = `${agrupacion}|${[...abiertas].sort().join(',')}`;
  return (
    <Tarjeta titulo={TITULO_PRINCIPALES[agrupacion]} pregunta="¿Qué pesa más en mis gastos?" claveImagen={claveImagen}>
      {filas.length === 0 ? <Vacio titulo={tituloVacio('gastos', ctx.actual.sinEquivalenteEgresos)} detalle="Sin egresos no hay nada que ordenar." /> : (
        <>
          <ListaProfunda filas={filas} agrupacion={agrupacion} ctx={ctx} etiquetaAria={`${TITULO_PRINCIPALES[agrupacion]}, de mayor a menor`} abiertas={abiertas} onAlternar={alternar} />
          <p className="mt-3 text-xs text-w-texto2">{AYUDA[agrupacion]}</p>
        </>
      )}
    </Tarjeta>
  );
}

/** Pestaña GASTOS: la agrupación elegida (categoría, subcategoría, cuenta, proveedor/cliente) vale para la dona y la lista. */
export default function TabGastos({ ctx }: { ctx: ContextoEstadisticas }) {
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('categoria');
  const contraparte = useNombresContraparte(agrupacion === 'contraparte');
  const nombreContraparte = contraparte.nombreDe;
  const filas = useMemo(() => filasDeAgrupacion(agrupacion, {
    egresos: ctx.actual.egresos, indiceCategorias: ctx.indiceCategorias, bancas: ctx.bancasConArchivadas, nombreContraparte,
  }), [agrupacion, ctx.actual.egresos, ctx.indiceCategorias, ctx.bancasConArchivadas, nombreContraparte]);
  const selector = <ControlSegmentado opciones={AGRUPACIONES} valor={agrupacion} onCambiar={setAgrupacion} etiquetaAria="Agrupar los gastos por" />;
  return (
    <div className="space-y-4">
      {agrupacion === 'contraparte' && contraparte.cargando && <Aviso>Cargando los nombres de proveedores y clientes…</Aviso>}
      <DonaGastos ctx={ctx} filas={filas} agrupacion={agrupacion} selector={selector} />
      <TendenciaGastos ctx={ctx} />
      <TopGastos ctx={ctx} />
      <Principales ctx={ctx} agrupacion={agrupacion} filas={filas} />
    </div>
  );
}
