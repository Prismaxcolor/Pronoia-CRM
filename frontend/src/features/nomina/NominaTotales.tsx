import { Bloque, GrillaKpis, TarjetaKpi } from '../../components/ui';
import type { TotalesNomina } from '@shared/types/nomina-calculo';

const num = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n: number) => `USD ${num(n)}`;
const bs = (n: number | null) => (n === null ? '— (falta la tasa)' : `Bs ${num(n)}`);
const personas = (n: number) => `${n} trabajador${n === 1 ? '' : 'es'}`;

interface Props {
  titulo: string;
  id?: string;
  queEstasViendo: string;
  totales: TotalesNomina;
}

/** Los cuatro totales que pide la nómina: divisas, Bs, equivalente en divisas de los Bs y la suma combinada. */
function NominaTotales({ titulo, id, queEstasViendo, totales: t }: Props) {
  return (
    <Bloque titulo={titulo} id={id} queEstasViendo={queEstasViendo}>
      <GrillaKpis>
        <TarjetaKpi
          titulo="Total a pagar en divisas" valor={usd(t.totalDivisasUsd)} subtitulo={`${personas(t.cantidadDivisas)} con sueldo en USD`}
          ayuda="Suma de la parte en divisas (efectivo o Binance) de cada trabajador, ya con la bonificación y los descuentos."
        />
        <TarjetaKpi
          titulo="Total a pagar en bolívares" valor={bs(t.totalBs)} subtitulo={`${personas(t.cantidadBs)} con sueldo en Bs`}
          ayuda="Suma de la parte en bolívares de cada trabajador. Un trabajador puede cobrar las dos partes y cuenta en ambos totales."
        />
        <TarjetaKpi
          titulo="Equivalente en divisas de los Bs" valor={usd(t.equivalenteUsdDeBs)} subtitulo="Lo que valen en USD los pagos en Bs"
          ayuda="Los bolívares a pagar convertidos a dólares con la tasa de la nómina (es el mismo dinero visto en dólares)."
        />
        <TarjetaKpi
          titulo="Total combinado" valor={usd(t.totalCombinadoUsd)} subtitulo={`En bolívares: ${bs(t.totalCombinadoBs)}`}
          ayuda="Divisas + equivalente en divisas de los Bs. En bolívares: los Bs + las divisas convertidas con la tasa."
        />
      </GrillaKpis>
    </Bloque>
  );
}

export default NominaTotales;
