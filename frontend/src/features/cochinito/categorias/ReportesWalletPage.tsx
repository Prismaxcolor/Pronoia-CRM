import { useState } from 'react';
import { Bloque, EncabezadoPagina, Pestanas } from '../../../components/ui';
import { LECTURAS } from '../../../lib/offline/prefijos-lectura';
import NavegacionWallet from './NavegacionWallet';
import ReporteCategoriasPanel from './ReporteCategoriasPanel';
import ReporteCuentaPanel from './ReporteCuentaPanel';
import { useCategorias } from './useCategorias';

type Reporte = 'cuenta' | 'categorias';

const PESTANAS = [
  { valor: 'cuenta', etiqueta: 'Movimientos de una cuenta' },
  { valor: 'categorias', etiqueta: 'Por categorías' },
] as const;

/** Sección "Reportes" del Wallet: reportes imprimibles (PDF) de una cuenta o caja y de gastos e ingresos por categoría. */
function ReportesWalletPage() {
  const [reporte, setReporte] = useState<Reporte>('cuenta');
  const categorias = useCategorias();

  return (
    <div className="max-w-6xl">
      <EncabezadoPagina
        lecturas={LECTURAS.cochinito}
        titulo="Wallet"
        subtitulo="Reportes para imprimir o guardar en PDF. Los montos se muestran en la moneda de cada cuenta; nunca se suman Bs con USD."
      />
      <NavegacionWallet />
      <Pestanas pestanas={PESTANAS} valor={reporte} onCambiar={setReporte} etiquetaAria="Tipo de reporte">
        {reporte === 'cuenta' ? (
          <Bloque titulo="Movimientos de una cuenta o caja" queEstasViendo="Todos los movimientos de la cuenta elegida entre las fechas indicadas, con su categoría, lo que entró, lo que salió y el neto.">
            <ReporteCuentaPanel />
          </Bloque>
        ) : (
          <Bloque titulo="Ingresos y egresos por categoría" queEstasViendo="Para las categorías elegidas y el periodo: ingresos, egresos y total por categoría, con el subtotal de cada subcategoría. Una tabla por moneda.">
            <ReporteCategoriasPanel categorias={categorias.categorias} indice={categorias.indice} error={categorias.error} />
          </Bloque>
        )}
      </Pestanas>
    </div>
  );
}

export default ReportesWalletPage;
