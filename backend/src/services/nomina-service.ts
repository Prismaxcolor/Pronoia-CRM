import { supabaseAdmin } from '../config/supabase.js';
import { falloNomina, type FalloNomina } from '../utils/nomina-errores.js';
import { nombreCompleto } from '../utils/nomina-armado.js';
import { IDS_POR_CONSULTA, trocear } from '../utils/paginacion.js';
import { cuotaSugerida } from '../utils/nomina-calculo.js';
import { partesDePago, sueldoBsComoUsd } from '../utils/nomina-partes-pago.js';
import { pagosDeNomina } from './nomina-pago-lectura.js';
import type {
  CandidatoNomina, EstadoNomina, LineaNomina, Nomina, NominaResumen, NominaSemana, TipoPrestamo, TipoTrabajador, TotalesNomina,
} from '../../../shared/types/nomina.js';

const LIMITE_NOMINAS = 200;
const COLUMNAS_DETALLE =
  '*, lineas:nomina_lineas(*, cuotas:nomina_linea_cuotas(prestamo_id, monto_usd, prestamo:nomina_prestamos(numero)))';

type Fila = Record<string, unknown>;

const numeroONull = (v: unknown): number | null => (v == null ? null : Number(v));

function totalesDe(row: Fila, cantidad: number): TotalesNomina {
  return {
    cantidad,
    cantidadDivisas: Number(row.cantidad_divisas ?? 0),
    cantidadBs: Number(row.cantidad_bs ?? 0),
    totalDivisasUsd: Number(row.total_divisas_usd ?? 0),
    totalBs: numeroONull(row.total_bs),
    equivalenteUsdDeBs: Number(row.total_equivalente_usd ?? 0),
    totalCombinadoUsd: Number(row.total_combinado_usd ?? 0),
    totalCombinadoBs: numeroONull(row.total_combinado_bs),
  };
}

function mapLinea(row: Fila, tasaBs: number | null): LineaNomina {
  const cuotas = (row.cuotas as Fila[] | null) ?? [];
  return {
    trabajadorId: row.trabajador_id as string,
    trabajadorNombre: row.trabajador_nombre as string,
    monedaPago: row.moneda_pago as LineaNomina['monedaPago'],
    diasTrabajados: Number(row.dias_trabajados),
    montoBaseUsd: Number(row.monto_base_usd),
    montoBaseBs: sueldoBsComoUsd(row, tasaBs),
    totalBrutoUsd: Number(row.total_bruto_usd),
    brutoBs: Number(row.bruto_bs ?? 0),
    montoRefBs: numeroONull(row.monto_ref_bs),
    bonificacionUsd: Number(row.bonificacion_usd),
    descuentoTrabajoUsd: Number(row.descuento_trabajo_usd),
    descuentoPrestamoUsd: Number(row.descuento_prestamo_usd),
    ...partesDePago(row),
    totalUsd: Number(row.total_usd),
    totalBs: numeroONull(row.total_bs),
    nota: (row.nota as string | null) ?? null,
    cuotas: cuotas.map(c => ({
      prestamoId: c.prestamo_id as string,
      prestamoNumero: Number((c.prestamo as Fila | null)?.numero ?? 0),
      montoUsd: Number(c.monto_usd),
    })),
  };
}

export function mapNomina(row: Fila): Nomina {
  const tasaBs = numeroONull(row.tasa_bs);
  const lineas = ((row.lineas as Fila[] | null) ?? [])
    .map(l => mapLinea(l, tasaBs))
    .sort((a, b) => a.trabajadorNombre.localeCompare(b.trabajadorNombre, 'es'));
  return {
    id: row.id as string,
    numero: Number(row.numero),
    tipo: row.tipo as TipoTrabajador,
    semanaInicio: row.semana_inicio as string,
    tasaBs,
    estado: row.estado as EstadoNomina,
    version: Number(row.version),
    totales: totalesDe(row, lineas.length),
    lineas,
    cerradaEn: (row.cerrada_at as string | null) ?? null,
    anuladaMotivo: (row.anulada_motivo as string | null) ?? null,
    anuladaEn: (row.anulada_at as string | null) ?? null,
    pagos: [],
  };
}

function mapResumen(row: Fila): NominaResumen {
  // Un trabajador con las dos partes cuenta en los dos grupos: la cantidad de personas se guarda aparte. Las nóminas
  // anteriores a los dos sueldos no la tienen y sus grupos no se cruzan, así que la suma sigue valiendo.
  const cantidad = row.cantidad_trabajadores == null
    ? Number(row.cantidad_divisas ?? 0) + Number(row.cantidad_bs ?? 0)
    : Number(row.cantidad_trabajadores);
  return {
    id: row.id as string,
    numero: Number(row.numero),
    tipo: row.tipo as TipoTrabajador,
    semanaInicio: row.semana_inicio as string,
    tasaBs: numeroONull(row.tasa_bs),
    estado: row.estado as EstadoNomina,
    totales: totalesDe(row, cantidad),
  };
}

export async function listarNominas(
  filtro: { tipo?: TipoTrabajador; desde?: string; hasta?: string },
): Promise<{ nominas: NominaResumen[] } | FalloNomina> {
  let q = supabaseAdmin
    .from('nominas').select('*')
    .order('semana_inicio', { ascending: false }).order('numero', { ascending: false }).limit(LIMITE_NOMINAS);
  if (filtro.tipo) q = q.eq('tipo', filtro.tipo);
  if (filtro.desde) q = q.gte('semana_inicio', filtro.desde);
  if (filtro.hasta) q = q.lte('semana_inicio', filtro.hasta);
  const { data, error } = await q;
  if (error) return falloNomina(error, 'nominas_listar', 'No se pudo cargar el historial de nóminas.');
  return { nominas: (data ?? []).map(mapResumen) };
}

/** Renglón (id) -> trabajador de la nómina leída, para ubicar a quién se pagó cada pago individual. */
function trabajadorPorLinea(row: Fila): Map<string, string> {
  const lineas = (row.lineas as Fila[] | null) ?? [];
  return new Map(lineas.map(l => [l.id as string, l.trabajador_id as string]));
}

export async function obtenerNomina(id: string): Promise<{ nomina: Nomina } | FalloNomina> {
  const { data, error } = await supabaseAdmin.from('nominas').select(COLUMNAS_DETALLE).eq('id', id).maybeSingle();
  if (error) return falloNomina(error, 'nomina_obtener', 'No se pudo cargar la nómina.');
  if (!data) return { error: 'Nómina no encontrada.', codigo: 404 };
  const nomina = mapNomina(data);
  // Los pagos solo existen en una nómina cerrada (o anulada tras pagarse); las demás se ahorran la consulta.
  if (nomina.estado === 'BORRADOR') return { nomina };
  const pagos = await pagosDeNomina(id, trabajadorPorLinea(data));
  if ('error' in pagos) return pagos;
  return { nomina: { ...nomina, pagos: pagos.pagos } };
}

function mapCandidato(t: Fila, prestamos: Fila[]): CandidatoNomina {
  return {
    trabajadorId: t.id as string,
    nombre: nombreCompleto({ nombres: t.nombres as string, apellidos: t.apellidos as string }),
    pagoDiarioUsd: Number(t.pago_diario_usd),
    pagoDiarioBs: Number(t.pago_diario_bs ?? 0),
    prestamos: prestamos.filter(p => p.trabajador_id === t.id).map(p => {
      const saldoUsd = Number(p.saldo_usd);
      const cuotaSemanalUsd = numeroONull(p.cuota_semanal_usd);
      return {
        id: p.id as string, numero: Number(p.numero), tipo: p.tipo as TipoPrestamo, saldoUsd, cuotaSemanalUsd,
        cuotaSugeridaUsd: cuotaSugerida({ saldoUsd, cuotaSemanalUsd }),
      };
    }),
  };
}

async function candidatosDe(tipo: TipoTrabajador): Promise<{ candidatos: CandidatoNomina[] } | FalloNomina> {
  const { data: trabajadores, error } = await supabaseAdmin
    // Solo lo que arma el candidato: sin cédula ni datos personales. Requiere la migración de los dos sueldos (pago_diario_bs).
    .from('nomina_trabajadores').select('id, nombres, apellidos, pago_diario_usd, pago_diario_bs')
    .eq('tipo', tipo).eq('activo', true).order('apellidos').order('nombres').limit(1000);
  if (error) return falloNomina(error, 'candidatos_trabajadores', 'No se pudo cargar el personal.');
  const ids = (trabajadores ?? []).map(t => t.id as string);
  if (ids.length === 0) return { candidatos: [] };
  const lotes = await Promise.all(trocear(ids, IDS_POR_CONSULTA).map(trozo => supabaseAdmin
    .from('nomina_prestamos').select('id, numero, trabajador_id, tipo, saldo_usd, cuota_semanal_usd')
    .eq('estado', 'ACTIVO').in('trabajador_id', trozo).order('numero').limit(2000)));
  const errP = lotes.find(l => l.error)?.error;
  if (errP) return falloNomina(errP, 'candidatos_prestamos', 'No se pudieron cargar los préstamos.');
  const prestamos = lotes.flatMap(l => l.data ?? []);
  return { candidatos: (trabajadores ?? []).map(t => mapCandidato(t, prestamos)) };
}

/** La nómina vigente (no anulada) de (tipo, semana), si existe, y los trabajadores que se pueden agregar. */
export async function obtenerNominaSemana(tipo: TipoTrabajador, semana: string): Promise<NominaSemana | FalloNomina> {
  const { data, error } = await supabaseAdmin
    .from('nominas').select('id').eq('tipo', tipo).eq('semana_inicio', semana).neq('estado', 'ANULADA').maybeSingle();
  if (error) return falloNomina(error, 'nomina_semana', 'No se pudo cargar la nómina de la semana.');
  const [existente, candidatos] = await Promise.all([
    data ? obtenerNomina(data.id as string) : Promise.resolve(null),
    candidatosDe(tipo),
  ]);
  if (existente && 'error' in existente) return existente;
  if ('error' in candidatos) return candidatos;
  return { nomina: existente ? existente.nomina : null, candidatos: candidatos.candidatos };
}
