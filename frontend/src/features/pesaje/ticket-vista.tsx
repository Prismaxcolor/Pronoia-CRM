import { useMemo } from 'react';
import { Camera, ZoomIn } from 'lucide-react';
import { destinoLabel, type TicketPesaje, type TicketPesajeMaterial, type Vehiculo } from '@shared/types/index.js';
import {
  BarraApilada, Bloque, EstadoVacio, GrillaKpis, Insignia, TarjetaKpi, colorDeSerie, formatearNumero, formatearPct, infoTipoOperacion,
} from '../../components/ui';
import VehiculoResumen from '../../components/VehiculoResumen';
import { calcularKpisTicket, formatearPesoTicket } from '../../lib/ticket-kpis';
import { descripcionDiferencia } from './diferencia-peso';

/** Pantalla de lectura del ticket de pesaje (rediseño con el lenguaje del kit). Todo es `print:hidden`: la hoja impresa
 *  sale de ticket-impresion.tsx, que conserva el marcado anterior. */

export interface FotoGaleria {
  key: string;
  url: string;
  label: string;
  peso: number | null;
}

const kg = (n: number) => `${formatearPesoTicket(n)} kg`;

/** Etiquetas del encabezado: tipo, estado de facturación, ticket unido y pesaje externo. */
export function InsigniasTicket({ ticket }: { ticket: TicketPesaje }) {
  const tipo = infoTipoOperacion(ticket.tipo);
  return (
    <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2 print:hidden">
      <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia>
      {ticket.estado === 'bruto' ? (
        <Insignia tono="aviso" title="Se guardó solo con el peso global; faltan materiales y destinos">Borrador (en bruto)</Insignia>
      ) : (
        <Insignia tono={ticket.facturado ? 'exito' : 'aviso'}>{ticket.facturado ? 'Facturado' : 'Pendiente por facturar'}</Insignia>
      )}
      {ticket.ticketPrincipalId && (
        <Insignia tono="neutral" title="Su pesaje global se sumó al ticket principal; se edita y factura desde allí">
          Unido a {ticket.ticketPrincipalCodigo ?? 'otro ticket'}
        </Insignia>
      )}
      {ticket.pesajeExterior && <Insignia tono="info">Sin pesaje global</Insignia>}
    </div>
  );
}

function BotonFotos({ cantidad, onAbrir, etiqueta }: { cantidad: number; onAbrir: () => void; etiqueta: string }) {
  if (cantidad === 0) return <span className="text-xs text-text-muted">Sin fotos</span>;
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`Ver ${cantidad} ${cantidad === 1 ? 'foto' : 'fotos'} de ${etiqueta}`}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <Camera size={13} aria-hidden="true" /> {cantidad}
    </button>
  );
}

interface Props {
  ticket: TicketPesaje;
  fotos: ReadonlyArray<FotoGaleria>;
  vehiculoDelCatalogo: Vehiculo | null | undefined;
  ocultarDestino: boolean;
  onOcultarDestino: (valor: boolean) => void;
  totalesPorMaterial: ReadonlyArray<{ nombre: string; total: number; cantidad: number }>;
  onAbrirFoto: (foto: FotoGaleria) => void;
  /** Presente solo si el usuario puede editar: ofrece la acción en el estado vacío de fotos. */
  onEditar?: () => void;
}

function TicketVista({ ticket, fotos, vehiculoDelCatalogo, ocultarDestino, onOcultarDestino, totalesPorMaterial, onAbrirFoto, onEditar }: Props) {
  const kpis = useMemo(() => calcularKpisTicket(ticket), [ticket]);
  const esBruto = ticket.estado === 'bruto';
  const abrirPrimera = (prefijo: string) => {
    const f = fotos.find(x => x.key.startsWith(prefijo));
    if (f) onAbrirFoto(f);
  };
  const fotosDe = (prefijo: string) => fotos.filter(x => x.key.startsWith(prefijo)).length;
  const alerta = kpis.severidad === 'alta' || kpis.severidad === 'favorece';

  return (
    <div className="print:hidden">
      <GrillaKpis>
        <TarjetaKpi
          titulo="Peso neto total"
          ayuda="Suma del peso neto (bruto menos tara) de todos los materiales del ticket. No incluye la devolución."
          estado={esBruto ? 'vacio' : 'listo'}
          mensajeVacio="Aún sin materiales: el ticket está en borrador"
          valor={formatearPesoTicket(kpis.netoTotal)}
          unidad="kg"
          subtitulo={`Suma de ${kpis.pesadasMaterial} ${kpis.pesadasMaterial === 1 ? 'línea de material' : 'líneas de material'}`}
        />
        <TarjetaKpi
          titulo="Peso global"
          ayuda="Lo que registró la báscula con el camión completo, sumando todas sus pesadas (bruto menos tara de cada una)."
          estado={ticket.pesajeExterior ? 'vacio' : 'listo'}
          mensajeVacio="Sin pesaje global: se pesó en una báscula externa"
          valor={formatearPesoTicket(kpis.pesoGlobal)}
          unidad="kg"
          subtitulo={kpis.pesadasGlobales > 0
            ? `${kpis.pesadasGlobales} ${kpis.pesadasGlobales === 1 ? 'pesada' : 'pesadas'} del camión`
            : 'Total registrado en el ticket'}
        />
        <TarjetaKpi
          titulo="Diferencia"
          ayuda={<>Peso global − neto de materiales − devolución. Positiva: merma o peso sin clasificar. Negativa: los materiales superan el global. Se resalta cuando es negativa o supera el 0,6 % del peso global.</>}
          estado={kpis.diferencia === null ? 'vacio' : 'listo'}
          mensajeVacio={esBruto ? 'Se calcula al completar el ticket' : 'No aplica: no hay pesaje global'}
          valor={kpis.diferencia === null ? undefined : formatearPesoTicket(kpis.diferencia)}
          unidad="kg"
          tonoValor={alerta ? 'peligro' : 'normal'}
          subtitulo={kpis.diferencia === null ? undefined : (
            <>
              {alerta && <strong className="font-semibold">{kpis.severidad === 'favorece' ? 'Revisar: ' : 'Fuera de rango: '}</strong>}
              {formatearPct(kpis.diferenciaPct ?? 0, 2)} del peso global · {descripcionDiferencia(kpis.diferencia)}
            </>
          )}
        />
        <TarjetaKpi
          titulo="Materiales"
          ayuda="Cantidad de materiales distintos del ticket. Si un material se pesó varias veces cuenta una sola vez."
          estado={esBruto ? 'vacio' : 'listo'}
          mensajeVacio="Aún sin materiales: el ticket está en borrador"
          valor={formatearNumero(kpis.materialesDistintos)}
          unidad={kpis.materialesDistintos === 1 ? 'material' : 'materiales'}
          subtitulo={`${kpis.pesadasMaterial} ${kpis.pesadasMaterial === 1 ? 'pesada' : 'pesadas'} en total`}
        />
      </GrillaKpis>

      {kpis.composicion.length >= 2 && (
        <Bloque titulo="Composición por material" queEstasViendo="cómo se reparten los kilos netos del ticket entre sus materiales; cada tramo es un material.">
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarraApilada
              segmentos={kpis.composicion.map((p, i) => ({ clave: p.clave, etiqueta: p.nombre, valor: p.kg, color: colorDeSerie(i) }))}
              formatoValor={kg}
              leyenda="fila"
              alto="h-4"
              rotulo="Kilos netos por material"
            />
          </div>
        </Bloque>
      )}

      <Bloque
        titulo="Materiales"
        queEstasViendo="cada material pesado con su destino de inventario, bruto, tara y neto, más las fotos de la báscula."
        acciones={!esBruto && (
          <label className="flex w-fit cursor-pointer select-none items-center gap-1.5 text-xs text-text-secondary">
            <input type="checkbox" checked={ocultarDestino} onChange={e => onOcultarDestino(e.target.checked)} className="rounded border-border" />
            Ocultar destino al imprimir (versión para el proveedor)
          </label>
        )}
      >
        {esBruto ? (
          <EstadoVacio
            mensaje="Ticket en borrador: materiales pendientes de registro."
            descripcion="No se contabiliza en inventario hasta que se completen los materiales y sus destinos."
            accion={{ etiqueta: 'Ir a Pesaje para completarlo', to: '/pesaje' }}
          />
        ) : ticket.materiales.length === 0 ? (
          <EstadoVacio mensaje="Este ticket no tiene materiales registrados." />
        ) : (
          <TablaMateriales
            ticket={ticket}
            ocultarDestino={ocultarDestino}
            totalesPorMaterial={totalesPorMaterial}
            fotosDe={id => fotosDe(`m-${id}-`)}
            abrirFotos={id => abrirPrimera(`m-${id}-`)}
          />
        )}
      </Bloque>

      <Bloque
        titulo="Pesaje global"
        queEstasViendo="las pesadas del camión por la báscula general: bruto, tara y neto de cada una; su suma es el peso global."
      >
        {ticket.pesajeExterior ? (
          <EstadoVacio mensaje="Sin pesaje global." descripcion="El camión se pesó en una báscula externa; no hay lectura propia contra la cual comparar." />
        ) : ticket.pesajesGlobales.length === 0 ? (
          <EstadoVacio
            mensaje={`Peso global total: ${kg(ticket.pesoGlobal)}.`}
            descripcion="Este ticket no guarda el desglose por pesada (es anterior a ese registro)."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {ticket.pesajesGlobales.map((p, i) => (
              <li key={p.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text-primary">Pesada {i + 1}</h3>
                  <BotonFotos cantidad={fotosDe(`p-${p.id}-`)} onAbrir={() => abrirPrimera(`p-${p.id}-`)} etiqueta={`la pesada ${i + 1}`} />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-text-secondary">Bruto</dt><dd className="tabular-nums text-text-primary">{kg(p.peso)}</dd></div>
                  <div><dt className="text-xs text-text-secondary">Tara</dt><dd className="tabular-nums text-text-primary">{kg(p.tara)}</dd></div>
                  <div><dt className="text-xs text-text-secondary">Neto</dt><dd className="font-semibold tabular-nums text-text-primary">{kg(p.peso - p.tara)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Bloque>

      <Bloque
        titulo="Devolución, vehículo y observaciones"
        queEstasViendo="el peso devuelto (solo conciliación, no mueve inventario ni factura), el vehículo del viaje y las notas del pesaje."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <article className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-2 text-sm font-medium text-text-secondary">Devolución</h3>
            {ticket.devolucion > 0 ? (
              <>
                <p className="text-2xl font-bold tabular-nums text-text-primary">{formatearPesoTicket(ticket.devolucion)}<span className="ml-1 text-sm font-medium text-text-secondary">kg</span></p>
                <div className="mt-2"><BotonFotos cantidad={ticket.fotosDevolucion.length} onAbrir={() => abrirPrimera('d-')} etiqueta="la devolución" /></div>
              </>
            ) : (
              <p className="text-sm text-text-secondary">Sin devolución registrada.</p>
            )}
          </article>
          <article className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-2 text-sm font-medium text-text-secondary">Vehículo</h3>
            {ticket.vehiculo ? (
              vehiculoDelCatalogo
                ? <VehiculoResumen vehiculo={vehiculoDelCatalogo} />
                : <p className="text-sm font-semibold text-text-primary">{ticket.vehiculo}</p>
            ) : (
              <p className="text-sm text-text-secondary">Sin vehículo asignado.</p>
            )}
          </article>
          <article className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-2 text-sm font-medium text-text-secondary">Observaciones</h3>
            {ticket.observaciones
              ? <p className="whitespace-pre-line break-words text-sm text-text-primary">{ticket.observaciones}</p>
              : <p className="text-sm text-text-secondary">Sin observaciones.</p>}
          </article>
        </div>
      </Bloque>

      <Bloque titulo="Fotos" queEstasViendo="todas las fotos del ticket (materiales, pesadas del camión y devolución); toca una para verla en grande.">
        {fotos.length === 0 ? (
          <EstadoVacio
            mensaje="Sin fotos"
            descripcion="Ni los materiales ni las pesadas de este ticket tienen fotos adjuntas."
            accion={onEditar ? { etiqueta: 'Editar el ticket para agregarlas', onClick: onEditar } : undefined}
          />
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {fotos.map(f => (
              <li key={f.key}>
                <button
                  type="button"
                  onClick={() => onAbrirFoto(f)}
                  className="group relative block aspect-square w-full overflow-hidden rounded-lg border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  aria-label={`Ver en grande la foto: ${f.label}`}
                >
                  <img src={f.url} alt={f.label} loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-1 text-left text-[10px] leading-tight text-white">{f.label}</span>
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                    <ZoomIn size={16} className="text-white opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Bloque>
    </div>
  );
}

interface TablaProps {
  ticket: TicketPesaje;
  ocultarDestino: boolean;
  totalesPorMaterial: ReadonlyArray<{ nombre: string; total: number; cantidad: number }>;
  fotosDe: (materialId: string) => number;
  abrirFotos: (materialId: string) => void;
}

function destinoDe(m: TicketPesajeMaterial): string {
  return destinoLabel(m.destinoTipo, m.nombreLote);
}

/** Tabla en escritorio y tarjetas apiladas en móvil (el mismo contenido en dos formas). */
function TablaMateriales({ ticket, ocultarDestino, totalesPorMaterial, fotosDe, abrirFotos }: TablaProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Materiales del ticket {ticket.codigo}</caption>
          <thead>
            <tr className="bg-surface-alt text-left text-xs text-text-secondary">
              <th scope="col" className="px-5 py-2 font-medium">Material</th>
              {!ocultarDestino && <th scope="col" className="px-4 py-2 font-medium">Destino</th>}
              <th scope="col" className="px-4 py-2 text-right font-medium">Bruto (kg)</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Tara (kg)</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Neto (kg)</th>
              <th scope="col" className="px-5 py-2 text-right font-medium">Fotos</th>
            </tr>
          </thead>
          <tbody>
            {ticket.materiales.map(m => (
              <tr key={m.id} className="border-t border-border">
                <td className="px-5 py-2.5 text-text-primary">{m.nombreProducto ?? '—'}</td>
                {!ocultarDestino && <td className="px-4 py-2.5 text-text-secondary">{destinoDe(m)}</td>}
                <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{formatearPesoTicket(m.pesoBruto)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{formatearPesoTicket(m.tara)}</td>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums text-text-primary">{formatearPesoTicket(m.pesoNeto)}</td>
                <td className="px-5 py-2.5 text-right"><BotonFotos cantidad={fotosDe(m.id)} onAbrir={() => abrirFotos(m.id)} etiqueta={m.nombreProducto ?? 'el material'} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {ticket.devolucion > 0 && (
              <tr className="border-t border-border bg-surface-alt/40">
                <th scope="row" colSpan={ocultarDestino ? 3 : 4} className="px-5 py-2.5 text-left font-medium text-text-primary">Devolución</th>
                <td className="px-4 py-2.5 text-right font-medium tabular-nums text-text-primary">{formatearPesoTicket(ticket.devolucion)}</td>
                <td />
              </tr>
            )}
            <tr className="border-t border-border bg-surface-alt">
              <th scope="row" colSpan={ocultarDestino ? 3 : 4} className="px-5 py-2.5 text-left font-semibold text-text-primary">Total neto</th>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-text-primary">{formatearPesoTicket(ticket.pesoNetoTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <ul className="divide-y divide-border md:hidden">
        {ticket.materiales.map(m => (
          <li key={m.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-text-primary">{m.nombreProducto ?? '—'}</p>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">{kg(m.pesoNeto)}</p>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {!ocultarDestino && (<><dt className="text-text-secondary">Destino</dt><dd className="text-right text-text-primary">{destinoDe(m)}</dd></>)}
              <dt className="text-text-secondary">Bruto</dt><dd className="text-right tabular-nums text-text-primary">{kg(m.pesoBruto)}</dd>
              <dt className="text-text-secondary">Tara</dt><dd className="text-right tabular-nums text-text-primary">{kg(m.tara)}</dd>
            </dl>
            <div className="mt-2"><BotonFotos cantidad={fotosDe(m.id)} onAbrir={() => abrirFotos(m.id)} etiqueta={m.nombreProducto ?? 'el material'} /></div>
          </li>
        ))}
        {ticket.devolucion > 0 && (
          <li className="flex justify-between bg-surface-alt/40 p-4 text-sm"><span className="font-medium text-text-primary">Devolución</span><span className="tabular-nums text-text-primary">{kg(ticket.devolucion)}</span></li>
        )}
        <li className="flex justify-between bg-surface-alt p-4 text-sm"><span className="font-semibold text-text-primary">Total neto</span><span className="font-semibold tabular-nums text-text-primary">{kg(ticket.pesoNetoTotal)}</span></li>
      </ul>

      {totalesPorMaterial.length > 0 && (
        <div className="border-t border-border bg-surface-alt/60 px-5 py-3">
          <p className="mb-1.5 text-[11px] font-medium text-text-secondary">
            Total por material ({totalesPorMaterial.reduce((acc, t) => acc + t.cantidad, 0)} pesadas)
          </p>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {totalesPorMaterial.map(t => (
              <li key={t.nombre} className="flex items-baseline gap-1.5 text-sm">
                <span className="text-text-secondary">{t.nombre}</span>
                <span className="text-xs text-text-muted">({t.cantidad}×)</span>
                <span className="font-semibold tabular-nums text-text-primary">{kg(t.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default TicketVista;
