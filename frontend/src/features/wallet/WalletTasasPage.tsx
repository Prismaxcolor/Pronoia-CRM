import { Bloque } from '../../components/ui';
import TasaCambioWidget from '../cochinito/TasaCambioWidget';

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const QUINCE_MIN_MS = 15 * 60 * 1000;

/** Pestaña "Tasas" de la Wallet: BCV, Binance y Euro (los mismos widgets de la Wallet clásica). */
function WalletTasasPage() {
  return (
    <Bloque
      titulo="Tasas de cambio"
      queEstasViendo="Cuántos bolívares (Bs) cuesta hoy 1 USD (tasa oficial BCV y tasa de Binance) y 1 EUR (BCV). Cada tarjeta muestra cuánto cambió en las últimas lecturas, cuándo se actualizó y cuándo se vuelve a consultar."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TasaCambioWidget fuenteKey="bcv" titulo="Tasa BCV" subtitulo="Dólar oficial · Banco Central de Venezuela" monedaOrigen="USD" cacheMs={UN_DIA_MS} acento="brand" />
        <TasaCambioWidget fuenteKey="binance" titulo="Tasa Binance" subtitulo="Dólar paralelo · Binance P2P, precio de venta" monedaOrigen="USD" cacheMs={QUINCE_MIN_MS} acento="binance" />
        <TasaCambioWidget fuenteKey="euro" titulo="Tasa Euro" subtitulo="Euro oficial · Banco Central de Venezuela" monedaOrigen="EUR" cacheMs={UN_DIA_MS} acento="euro" />
      </div>
    </Bloque>
  );
}

export default WalletTasasPage;
