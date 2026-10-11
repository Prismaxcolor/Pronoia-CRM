import { Bloque, GrillaKpis, TarjetaKpi } from '../../components/ui';
import type { TotalesNomina } from '@shared/types/nomina-calculo';

const num = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n: number) => `USD ${num(n)}`;
const bs = (n: number | null) => (n === null ? '— (falta la tasa)' : `Bs ${num(n)}`);
const personas = (n: number) => `${n} trabajador${n === 1 ? '' : 'es'}`;

interface Props {
  titulo: string;
  queEstasViendo: string;
  totales: TotalesNomina;
}

/** Los cuatro totales que pide la nómina: divisas, Bs, equivalente en divisas de los Bs y la suma combinada. */
function NominaTotales({ titulo, queEstasViendo, totales: t }: Props) {
  return (
    <Bloque titulo={titulo} queEstasViendo={queEstasViendo}>
      <GrillaKpis>
        <TarjetaKpi
          titulo="Total a pagar en divisas" valor={usd(t.totalDivisasUsd)} subtitulo={`${personas(t.cantidadDivisas)} que se pagan en USD`}
          ayuda="Suma del total a pagar de los trabajadores marcados como pago en divisas."
        />
        <TarjetaKpi
          titulo="Total a pagar en bolívares" valor={bs(t.totalBs)} subtitulo={`${personas(t.cantidadBs)} que se pagan en Bs`}
          ayuda="Suma del total en Bs (total en USD x tasa) de los trabajadores marcados como pago en bolívares."
        />
        <TarjetaKpi
          titulo="Equivalente en divisas de los Bs" valor={usd(t.equivalenteUsdDeBs)} subtitulo="Lo que valen en USD los pagos en Bs"
          ayuda="Suma del total en USD de los trabajadores que se pagan en Bs (es el mismo dinero visto en dólares)."
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
