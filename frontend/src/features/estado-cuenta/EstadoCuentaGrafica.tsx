import { useMemo } from 'react';
import { EstadoVacio, LineaTiempo, formatearUsdDecimales } from '../../components/ui';
import { puntosSaldoCorrido, type EntradaConSaldo } from '../../lib/terceros-kpis';

/** Línea del saldo acumulado día a día (cargo suma, abono resta). Se carga aparte (lazy) después de los indicadores. */
function EstadoCuentaGrafica({ entradas }: { entradas: readonly EntradaConSaldo[] }) {
  const puntos = useMemo(() => puntosSaldoCorrido(entradas), [entradas]);
  if (puntos.length < 2) {
    return (
      <EstadoVacio
        mensaje="Aún no hay suficientes días con movimientos para dibujar la línea"
        descripcion="Hacen falta movimientos en al menos 2 fechas distintas dentro del periodo. Amplía las fechas del filtro o registra más movimientos."
      />
    );
  }
  return (
    <LineaTiempo
      puntos={puntos}
      etiquetaAria="Saldo acumulado de la cuenta, en USD, por día"
      formatoValor={v => formatearUsdDecimales(v, 2)}
      alto={220}
    />
  );
}

export default EstadoCuentaGrafica;
