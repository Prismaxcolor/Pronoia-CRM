import type { ContextoEstadisticas } from './contexto';
import LibroIngresosGastos from './LibroIngresosGastos';
import TablaEfectivo from './TablaEfectivo';

/** Pestaña INFORMES: tabla de flujo de efectivo y libro de ingresos y gastos. */
export default function TabInformes({ ctx }: { ctx: ContextoEstadisticas }) {
  return (
    <div className="space-y-4">
      <TablaEfectivo ctx={ctx} />
      <LibroIngresosGastos ctx={ctx} />
    </div>
  );
}
