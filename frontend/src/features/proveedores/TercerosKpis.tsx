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
        ayuda={`Cuántos ${t.plural} hay registrados y cuántos están activos. Un ${t.singular} inactivo conserva su historial pero ya no aparece en los selectores.`}
        valor={formatearNumero(r.total, 0)}
        unidad={r.total === 1 ? 'registrado' : 'registrados'}
        subtitulo={`${formatearNumero(r.activos, 0)} ${r.activos === 1 ? 'activo' : 'activos'}`}
        comparacion={null}
      />
      <TarjetaKpi
        titulo="Con Telegram vinculado"
        icono={<Send size={16} />}
        ayuda={`Cuántos ${t.plural} ya vincularon su Telegram. Con Telegram vinculado se les puede enviar el estado de cuenta desde su pantalla.`}
        valor={formatearNumero(r.conTelegram, 0)}
        unidad={`de ${formatearNumero(r.total, 0)}`}
        subtitulo={r.activosSinTelegram > 0 ? `${formatearNumero(r.activosSinTelegram, 0)} activos sin vincular` : 'Todos los activos están vinculados'}
        comparacion={null}
      />
      <TarjetaKpi
        titulo={`${t.saldo} a ${t.plural}`}
        icono={<HandCoins size={16} />}
        ayuda={`Suma de los saldos positivos de todos los ${t.plural}, en USD: lo que ${tipo === 'proveedor' ? 'se les debe pagar' : 'nos deben'}. Es la misma cifra del saldo de cada estado de cuenta. Los saldos a favor (se ${tipo === 'proveedor' ? 'pagó' : 'cobró'} de más) no se restan: se muestran aparte.`}
        estado={estadoCifras}
        mensajeVacio={mensajeSinCifras}
        valor={formatearUsdDecimales(porSaldar, 2)}
        subtitulo="Foto actual de las cuentas"
        comparacion={null}
      >
        <p className="mt-1 text-xs text-text-secondary">
          {t.saldoAFavor}: <span className="font-medium tabular-nums text-text-primary">{formatearUsdDecimales(totales?.aFavor ?? 0, 2)}</span>
          {conAFavor > 0 && <> en {conAFavor} {conAFavor === 1 ? t.singular : t.plural}</>}
        </p>
      </TarjetaKpi>
      <TarjetaKpi
        titulo="Factura pendiente más antigua"
        icono={<Clock size={16} />}
        ayuda="Días desde la fecha de la factura pendiente más vieja de todos. El sistema no guarda fecha de vencimiento: se cuenta desde la fecha en que se emitió la factura."
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
