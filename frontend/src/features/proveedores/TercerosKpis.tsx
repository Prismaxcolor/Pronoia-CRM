import { Clock, HandCoins, Send, Users } from 'lucide-react';
import { GrillaKpis, TarjetaKpi, formatearNumero, formatearUsdDecimales } from '../../components/ui';
import {
  DIAS_ANTIGUEDAD_URGENTE, TEXTO_TERCERO, antiguedadMasVieja, resumenTerceros, type FilaTercero, type TipoTercero,
} from '../../lib/terceros-kpis';
import type { TotalesSaldos } from '@shared/types/saldos.js';
import type { EstadoSaldos } from './useSaldosTerceros';

interface Props {
  tipo: TipoTercero;
  filas: readonly FilaTercero[];
  estadoSaldos: EstadoSaldos;
  totales: TotalesSaldos | null;
}

/** Los 4 indicadores de la lista. Son una foto de HOY (no hay periodo anterior con el cual comparar). */
function TercerosKpis({ tipo, filas, estadoSaldos, totales }: Props) {
  const t = TEXTO_TERCERO[tipo];
  const r = resumenTerceros(filas);
  const vieja = antiguedadMasVieja(filas);
  const estadoCifras = estadoSaldos === 'listo' ? 'listo' : estadoSaldos === 'cargando' ? 'cargando' : estadoSaldos === 'sinPermiso' ? 'sinPermiso' : 'vacio';
  const mensajeSinCifras = 'No se pudieron calcular los saldos. Usa "Reintentar" arriba.';
  const porSaldar = totales?.porPagar ?? totales?.porCobrar ?? 0;
  const conAFavor = filas.filter(f => (f.saldo?.saldo ?? 0) < -0.005).length;

  return (
    <GrillaKpis>
      <TarjetaKpi
        titulo={t.plural.charAt(0).toUpperCase() + t.plural.slice(1)}
        icono={<Users size={16} />}
        ayuda={`Cuántos ${t.plural} hay registrados, y debajo cuántos de ellos están activos. Un ${t.singular} inactivo conserva su historial, pero ya no aparece para elegirlo en facturas y pagos.`}
        valor={formatearNumero(r.total, 0)}
        unidad={r.total === 1 ? 'registrado' : 'registrados'}
        subtitulo={`${formatearNumero(r.activos, 0)} ${r.activos === 1 ? 'activo' : 'activos'}`}
        comparacion={null}
      />
      <TarjetaKpi
        titulo="Con Telegram vinculado"
        icono={<Send size={16} />}
        ayuda={`Cuántos ${t.plural} tienen su Telegram vinculado, contando activos e inactivos. Con Telegram vinculado el sistema puede enviarles su estado de cuenta desde la pantalla de su estado de cuenta. Abajo se cuentan los activos que todavía no lo tienen.`}
        valor={formatearNumero(r.conTelegram, 0)}
        unidad={`de ${formatearNumero(r.total, 0)}`}
        subtitulo={r.activosSinTelegram > 0 ? `${formatearNumero(r.activosSinTelegram, 0)} activos sin vincular` : 'Todos los activos están vinculados'}
        comparacion={null}
      />
      <TarjetaKpi
        titulo={`${t.saldo} a ${t.plural}`}
        icono={<HandCoins size={16} />}
        ayuda={tipo === 'proveedor'
          ? 'Lo que se les debe pagar en total a los proveedores, en USD. De cada proveedor se toma lo facturado (facturas y notas de débito) menos lo pagado (pagos, adelantos y notas de crédito), y se suman solo los que quedan debiendo. Incluye todo el historial. Lo pagado de más se muestra aparte, no se resta.'
          : 'Lo que los clientes nos deben en total, en USD. De cada cliente se toma lo facturado (facturas y notas de débito) menos lo cobrado (cobros, anticipos y notas de crédito), y se suman solo los que quedan debiendo. Incluye todo el historial. Lo cobrado de más se muestra aparte, no se resta.'}
        estado={estadoCifras}
        mensajeVacio={mensajeSinCifras}
        valor={formatearUsdDecimales(porSaldar, 2)}
        subtitulo="Todo el historial, calculado a hoy"
        comparacion={null}
      >
        <p className="mt-1 text-xs text-text-secondary">
          {t.saldoAFavor}: <span className="font-medium tabular-nums text-text-primary">{formatearUsdDecimales(totales?.aFavor ?? 0, 2)}</span>
          {conAFavor > 0 && <> en {conAFavor} {conAFavor === 1 ? t.singular : t.plural}</>}
        </p>
      </TarjetaKpi>
      <TarjetaKpi
        titulo={`Factura más antigua sin ${t.verbo}`}
        icono={<Clock size={16} />}
        ayuda={`Los días que lleva la factura más vieja que todavía tiene algo sin ${t.verbo}, entre todos los ${t.plural}. Se cuentan desde la fecha en que se creó la factura hasta hoy, porque el sistema no guarda fecha de vencimiento. No cuenta facturas anuladas, en borrador ni ya pagadas. Debajo aparece de quién es.`}
        estado={estadoCifras === 'listo' && !vieja ? 'vacio' : estadoCifras}
        mensajeVacio={estadoCifras === 'listo' ? 'No hay facturas pendientes.' : mensajeSinCifras}
        valor={vieja ? formatearNumero(vieja.dias, 0) : undefined}
        unidad={vieja ? (vieja.dias === 1 ? 'día' : 'días') : undefined}
        subtitulo={vieja?.nombre}
        tonoValor={vieja && vieja.dias >= DIAS_ANTIGUEDAD_URGENTE ? 'peligro' : 'normal'}
        comparacion={null}
      />
    </GrillaKpis>
  );
}

export default TercerosKpis;
