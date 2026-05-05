import { useSearchParams } from 'react-router-dom';
import DashboardFacturacion from './DashboardFacturacion';
import EditorFactura from './EditorFactura';

function FacturacionPage() {
  const [searchParams] = useSearchParams();
  const facturaId = searchParams.get('factura');

  if (facturaId) {
    return <EditorFactura key={facturaId} facturaId={facturaId} />;
  }

  return <DashboardFacturacion />;
}

export default FacturacionPage;
